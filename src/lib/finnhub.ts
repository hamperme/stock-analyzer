/**
 * Finnhub stock data client.
 * Free tier: 60 API calls/minute — plenty for this app with caching.
 * Get a free key at https://finnhub.io/register
 */

import https from "https";
import { cache, TTL } from "./cache";
import type { StockQuote, HistoricalBar, NewsItem, NewsTag } from "./types";

function getKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not set in .env.local");
  return key;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      timeout: 10_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Finnhub HTTP ${res.statusCode}: ${body.slice(0, 100)}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("Finnhub returned invalid JSON")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Finnhub request timed out")); });
  });
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export async function getQuote(symbol: string): Promise<StockQuote> {
  const key = `fh:quote:${symbol}`;
  const cached = cache.get<StockQuote>(key);
  if (cached) return cached;

  const token = getKey();

  // Fetch quote + profile in parallel
  const [quoteData, profileData] = await Promise.allSettled([
    httpsGet(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`),
    httpsGet(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = quoteData.status === "fulfilled" ? quoteData.value : {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = profileData.status === "fulfilled" ? profileData.value : {};

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
    volume: 0, // Finnhub quote doesn't return volume; pulled from candles
    avgVolume: 0,
    marketCap: p.marketCapitalization ? p.marketCapitalization * 1_000_000 : null,
    fiftyTwoWeekHigh: q.h ?? 0,
    fiftyTwoWeekLow: q.l ?? 0,
    ma50: 0,
    ma200: 0,
    beta: null,
    currency: p.currency ?? "USD",
  };

  cache.set(key, quote, TTL.QUOTE);
  return quote;
}

// ─── Historical Data ──────────────────────────────────────────────────────────

export async function getHistoricalData(
  symbol: string,
  days = 365
): Promise<HistoricalBar[]> {
  const key = `fh:history:${symbol}:${days}`;
  const cached = cache.get<HistoricalBar[]>(key);
  if (cached) return cached;

  const token = getKey();
  const toTs = Math.floor(Date.now() / 1000);
  const fromTs = toTs - days * 24 * 60 * 60;

  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${fromTs}&to=${toTs}&token=${token}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await httpsGet(url)) as any;

  if (raw.s !== "ok" || !raw.t?.length) {
    throw new Error(`No candle data for ${symbol} (status: ${raw.s})`);
  }

  const bars: HistoricalBar[] = raw.t.map((ts: number, i: number) => ({
    date:   new Date(ts * 1000).toISOString().split("T")[0],
    open:   Math.round((raw.o[i] ?? 0) * 100) / 100,
    high:   Math.round((raw.h[i] ?? 0) * 100) / 100,
    low:    Math.round((raw.l[i] ?? 0) * 100) / 100,
    close:  Math.round((raw.c[i] ?? 0) * 100) / 100,
    volume: raw.v[i] ?? 0,
  })).filter((b: HistoricalBar) => b.close > 0);

  cache.set(key, bars, TTL.HISTORY);
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
  const key = `fh:news:${symbol}`;
  const cached = cache.get<NewsItem[]>(key);
  if (cached) return cached;

  try {
    const token = getKey();
    const to = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${token}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await httpsGet(url)) as any[];

    const items: NewsItem[] = (Array.isArray(raw) ? raw : []).slice(0, 15).map((n) => ({
      title:       n.headline ?? "No title",
      summary:     n.summary ?? "",
      url:         n.url ?? "#",
      publisher:   n.source ?? "Unknown",
      publishedAt: n.datetime ? new Date(n.datetime * 1000).toISOString() : new Date().toISOString(),
      tag:         tagFromTitle(n.headline ?? ""),
      sentiment:   sentimentFromTitle(n.headline ?? ""),
    }));

    cache.set(key, items, TTL.NEWS);
    return items;
  } catch (err) {
    console.error(`[getNews] ${symbol}:`, err);
    return [];
  }
}
