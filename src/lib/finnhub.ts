/**
 * Finnhub stock data client.
 * Free tier: 60 API calls/minute.
 *
 * Rate-limit strategy:
 *  - Global serial queue with 500 ms minimum gap between requests
 *  - Exponential backoff on HTTP 429: 2 s → 4 s → 8 s (3 attempts)
 *  - Circuit breaker: 60 s cooldown after 3 consecutive 429s
 *  - All results cached aggressively (HISTORY = 6 h, QUOTE = 1 min)
 */

import https from "https";
import { cache, TTL } from "./cache";
import type { StockQuote, HistoricalBar, NewsItem, NewsTag } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not set in .env.local");
  return key;
}

// ─── Global request throttle ─────────────────────────────────────────────────
let lastFinnhubRequest = 0;
let finnhubQueueLock: Promise<void> = Promise.resolve();

function throttledFetch(fn: () => Promise<unknown>): Promise<unknown> {
  finnhubQueueLock = finnhubQueueLock.then(async () => {
    const gap = Date.now() - lastFinnhubRequest;
    if (gap < 500) await sleep(500 - gap);
    lastFinnhubRequest = Date.now();
  });
  return finnhubQueueLock.then(fn);
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────
let finnhubBlockedUntil = 0;
function markBlocked() { finnhubBlockedUntil = Date.now() + 60_000; }
function isBlocked() { return Date.now() < finnhubBlockedUntil; }

export function getFinnhubStatus() {
  const now = Date.now();
  return {
    blocked: now < finnhubBlockedUntil,
    unblocksIn: Math.max(0, Math.round((finnhubBlockedUntil - now) / 1000)),
    hasKey: !!process.env.FINNHUB_API_KEY,
  };
}

// ─── Raw HTTP helper ─────────────────────────────────────────────────────────
function httpsGet(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      timeout: 10_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 0;
        try {
          resolve({ status, body: JSON.parse(raw) });
        } catch {
          reject(new Error(`Finnhub invalid JSON (HTTP ${status}): ${raw.slice(0, 120)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Finnhub request timed out")); });
  });
}

// ─── Fetch with circuit breaker + exponential backoff on 429 ─────────────────
async function fhFetch(url: string): Promise<unknown> {
  if (isBlocked()) throw new Error("Finnhub circuit breaker active (429 cooldown)");

  const delays = [2_000, 4_000, 8_000];
  for (let attempt = 0; attempt < 3; attempt++) {
    const { status, body } = await (throttledFetch(() => httpsGet(url)) as Promise<{ status: number; body: unknown }>);

    if (status === 429) {
      if (attempt === 2) {
        markBlocked();
        console.error("[finnhub] 429 × 3 — circuit breaker activated for 60 s");
        throw new Error("Finnhub HTTP 429: rate limited (circuit breaker activated)");
      }
      console.warn(`[finnhub] 429 on attempt ${attempt + 1}, retrying in ${delays[attempt] / 1000}s…`);
      await sleep(delays[attempt]);
      continue;
    }

    if (status === 403) {
      throw new Error(`Finnhub HTTP 403: access denied — ${JSON.stringify(body).slice(0, 100)}`);
    }

    if (status >= 400) {
      throw new Error(`Finnhub HTTP ${status}: ${JSON.stringify(body).slice(0, 100)}`);
    }

    return body;
  }
  throw new Error("Finnhub: max retries exceeded");
}

// ─── Quote ────────────────────────────────────────────────────────────────────
export async function getQuote(symbol: string): Promise<StockQuote> {
  const cacheKey = `fh:quote:${symbol}`;
  const cached = cache.get<StockQuote>(cacheKey);
  if (cached) return cached;

  const token = getKey();

  const [quoteData, profileData] = await Promise.allSettled([
    fhFetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`),
    fhFetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = quoteData.status === "fulfilled" ? quoteData.value : {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = profileData.status === "fulfilled" ? profileData.value : {};

  if (quoteData.status === "rejected") {
    console.warn(`[finnhub] Quote failed for ${symbol}:`, quoteData.reason?.message);
  }

  const price: number = q.c ?? 0;
  const prevClose: number = q.pc ?? price;
  const change = Math.round((price - prevClose) * 100) / 100;
  const changePercent = q.dp != null ? Math.round(q.dp * 100) / 100
    : prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;

  const quote: StockQuote = {
    symbol,
    shortName: p.name ?? symbol,
    longName: p.name ?? symbol,
    price,
    previousClose: prevClose,
    change,
    changePercent,
    volume: 0,
    avgVolume: 0,
    marketCap: p.marketCapitalization ? p.marketCapitalization * 1_000_000 : null,
    fiftyTwoWeekHigh: q.h ?? 0,
    fiftyTwoWeekLow: q.l ?? 0,
    ma50: 0,
    ma200: 0,
    beta: null,
    currency: p.currency ?? "USD",
  };

  cache.set(cacheKey, quote, TTL.QUOTE);
  return quote;
}

// ─── Historical Data ──────────────────────────────────────────────────────────
export async function getHistoricalData(
  symbol: string,
  days = 365
): Promise<HistoricalBar[]> {
  const cacheKey = `fh:history:${symbol}:${days}`;
  const cached = cache.get<HistoricalBar[]>(cacheKey);
  if (cached) return cached;

  // Also check if a longer range is already cached and slice it
  if (days < 1825) {
    const full = cache.get<HistoricalBar[]>(`fh:history:${symbol}:1825`);
    if (full) {
      const sliced = full.slice(-days);
      cache.set(cacheKey, sliced, TTL.HISTORY);
      return sliced;
    }
  }

  const token = getKey();
  const toTs = Math.floor(Date.now() / 1000);
  const fromTs = toTs - days * 24 * 60 * 60;

  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${fromTs}&to=${toTs}&token=${token}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await fhFetch(url)) as any;

  if (raw.s !== "ok" || !raw.t?.length) {
    throw new Error(`Finnhub: no candle data for ${symbol} (status: ${raw.s ?? "unknown"})`);
  }

  const bars: HistoricalBar[] = raw.t.map((ts: number, i: number) => ({
    date:   new Date(ts * 1000).toISOString().split("T")[0],
    open:   Math.round((raw.o[i] ?? 0) * 100) / 100,
    high:   Math.round((raw.h[i] ?? 0) * 100) / 100,
    low:    Math.round((raw.l[i] ?? 0) * 100) / 100,
    close:  Math.round((raw.c[i] ?? 0) * 100) / 100,
    volume: raw.v[i] ?? 0,
  })).filter((b: HistoricalBar) => b.close > 0);

  cache.set(cacheKey, bars, TTL.HISTORY);
  return bars;
}

// ─── News ─────────────────────────────────────────────────────────────────────
const TAG_PATTERNS: Array<{ pattern: RegExp; tag: NewsTag }> = [
  { pattern: /earnings|revenue|profit|eps|guidance|forecast|quarter/i,  tag: "Earnings" },
  { pattern: /launch|release|announce|unveil|introduce|new product/i,    tag: "Product Launch" },
  { pattern: /lawsuit|sec|investigation|fine|penalty|regulatory/i,       tag: "Legal" },
  { pattern: /partner|deal|agreement|collaboration|joint venture/i,      tag: "Partnership" },
  { pattern: /analyst|rating|upgrade|downgrade|price target/i,           tag: "Analyst Rating" },
  { pattern: /ceo|cfo|cto|resign|appoint|hire|executive|board/i,         tag: "Executive Change" },
  { pattern: /market|economy|fed|interest rate|inflation|gdp/i,          tag: "Market Sentiment" },
];

function tagFromTitle(title: string): NewsTag {
  for (const { pattern, tag } of TAG_PATTERNS) {
    if (pattern.test(title)) return tag;
  }
  return "General";
}

function sentimentFromTitle(title: string): NewsItem["sentiment"] {
  const pos = /surge|soar|jump|rally|beat|exceed|strong|record|bullish|growth|gain/i;
  const neg = /fall|drop|plunge|miss|weak|loss|concern|risk|bearish|decline|cut/i;
  if (pos.test(title)) return "positive";
  if (neg.test(title)) return "negative";
  return "neutral";
}

export async function getNews(symbol: string): Promise<NewsItem[]> {
  const cacheKey = `fh:news:${symbol}`;
  const cached = cache.get<NewsItem[]>(cacheKey);
  if (cached) return cached;

  try {
    const token = getKey();
    const to = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${token}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await fhFetch(url)) as any[];

    const items: NewsItem[] = (Array.isArray(raw) ? raw : []).slice(0, 15).map((n) => ({
      title:       n.headline ?? "No title",
      summary:     n.summary ?? "",
      url:         n.url ?? "#",
      publisher:   n.source ?? "Unknown",
      publishedAt: n.datetime ? new Date(n.datetime * 1000).toISOString() : new Date().toISOString(),
      tag:         tagFromTitle(n.headline ?? ""),
      sentiment:   sentimentFromTitle(n.headline ?? ""),
    }));

    cache.set(cacheKey, items, TTL.NEWS);
    return items;
  } catch (err) {
    console.error(`[finnhub] News failed for ${symbol}:`, (err as Error).message);
    return [];
  }
}
