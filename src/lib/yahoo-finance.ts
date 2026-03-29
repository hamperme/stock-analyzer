/**
 * Yahoo Finance data fetcher.
 * Uses Node.js native https module — avoids TLS fingerprint blocks
 * that affect Node.js fetch/undici with Yahoo Finance.
 */

import https from "https";
import { cache, TTL } from "./cache";
import type { StockQuote, HistoricalBar, NewsItem, NewsTag } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Circuit breaker: once Yahoo Finance rate-limits us, skip it for 15 minutes
let yahooBlockedUntil = 0;
function markYahooBlocked() { yahooBlockedUntil = Date.now() + 15 * 60 * 1000; }
function isYahooBlocked() { return Date.now() < yahooBlockedUntil; }

// ─── Native https fetch (bypasses Yahoo Finance TLS fingerprint blocking) ────

function httpsGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 5_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Invalid JSON from ${url}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout for ${url}`)); });
  });
}

async function yfFetch(url: string, retries = 1): Promise<unknown> {
  if (isYahooBlocked()) throw new Error("HTTP 429 (circuit breaker active)");
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await httpsGet(url);
    } catch (err) {
      const msg = (err as Error).message;
      // Never retry 429 — IP is blocked; trip the circuit breaker
      if (msg.includes("HTTP 429")) { markYahooBlocked(); throw err; }
      if (attempt < retries) {
        await sleep(800);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Max retries exceeded: ${url}`);
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export async function getQuote(symbol: string): Promise<StockQuote> {
  const key = `quote:${symbol}`;
  const cached = cache.get<StockQuote>(key);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=5d`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await yfFetch(url)) as any;
  const result = raw?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for ${symbol}`);

  const meta = result.meta ?? {};
  const prevClose: number = meta.chartPreviousClose ?? meta.regularMarketPrice ?? 0;
  const price: number = meta.regularMarketPrice ?? 0;
  const change = Math.round((price - prevClose) * 100) / 100;
  const changePercent =
    prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;

  const quote: StockQuote = {
    symbol: meta.symbol ?? symbol,
    shortName: meta.shortName ?? symbol,
    longName: meta.longName ?? meta.shortName ?? symbol,
    price,
    previousClose: prevClose,
    change,
    changePercent,
    volume: meta.regularMarketVolume ?? 0,
    avgVolume: 0,
    marketCap: null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? 0,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? 0,
    ma50: 0,
    ma200: 0,
    beta: null,
    currency: meta.currency ?? "USD",
  };

  cache.set(key, quote, TTL.QUOTE);
  return quote;
}

// ─── Historical Data via Spark (single-symbol, lighter endpoint) ─────────────
// The /v7/finance/spark endpoint is less rate-limited than /v8/finance/chart.
// It only returns close + timestamp (no OHLCV volume), but that's enough for
// RSI, MA calculation, and price line charts.

export async function getHistoricalDataSpark(
  symbol: string,
  days = 365
): Promise<HistoricalBar[]> {
  const key = `spark:${symbol}:${days}`;
  const cached = cache.get<HistoricalBar[]>(key);
  if (cached) return cached;

  const range =
    days <= 30  ? "1mo"  :
    days <= 90  ? "3mo"  :
    days <= 180 ? "6mo"  :
    days <= 365 ? "1y"   : "2y";

  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbol)}&range=${range}&interval=1d`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await yfFetch(url)) as any;
  const result = raw?.spark?.result?.[0];
  if (!result) throw new Error(`No spark data for ${symbol}`);

  const timestamps: number[] = result.response?.[0]?.timestamp ?? [];
  const closes: number[] = result.response?.[0]?.indicators?.quote?.[0]?.close ?? [];

  if (!closes.length) throw new Error(`No spark closes for ${symbol}`);

  const bars: HistoricalBar[] = timestamps
    .map((ts, i) => ({
      date:   new Date(ts * 1000).toISOString().split("T")[0],
      open:   closes[i] ?? 0,
      high:   closes[i] ?? 0,
      low:    closes[i] ?? 0,
      close:  Math.round((closes[i] ?? 0) * 100) / 100,
      volume: 0,
    }))
    .filter((b) => b.close > 0);

  cache.set(key, bars, TTL.HISTORY);
  return bars;
}

// ─── Historical Data ──────────────────────────────────────────────────────────

export async function getHistoricalData(
  symbol: string,
  days = 365
): Promise<HistoricalBar[]> {
  const key = `history:${symbol}:${days}`;
  const cached = cache.get<HistoricalBar[]>(key);
  if (cached) return cached;

  const range =
    days <= 30  ? "1mo"  :
    days <= 90  ? "3mo"  :
    days <= 180 ? "6mo"  :
    days <= 365 ? "1y"   : "2y";

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=${range}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await yfFetch(url)) as any;
  const result = raw?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);

  const timestamps: number[] = result.timestamp ?? [];
  const ohlcv = result.indicators?.quote?.[0] ?? {};
  const opens: number[]   = ohlcv.open   ?? [];
  const highs: number[]   = ohlcv.high   ?? [];
  const lows: number[]    = ohlcv.low    ?? [];
  const closes: number[]  = ohlcv.close  ?? [];
  const volumes: number[] = ohlcv.volume ?? [];

  const bars: HistoricalBar[] = timestamps
    .map((ts, i) => ({
      date:   new Date(ts * 1000).toISOString().split("T")[0],
      open:   Math.round((opens[i]   ?? 0) * 100) / 100,
      high:   Math.round((highs[i]   ?? 0) * 100) / 100,
      low:    Math.round((lows[i]    ?? 0) * 100) / 100,
      close:  Math.round((closes[i]  ?? 0) * 100) / 100,
      volume: volumes[i] ?? 0,
    }))
    .filter((b) => b.close > 0);

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
  const key = `news:${symbol}`;
  const cached = cache.get<NewsItem[]>(key);
  if (cached) return cached;

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      symbol
    )}&newsCount=20&enableFuzzyQuery=false&quotesCount=0`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await yfFetch(url)) as any;
    const rawNews: Array<{
      title?: string; link?: string;
      publisher?: string; providerPublishTime?: number;
    }> = json?.finance?.result?.[0]?.news ?? json?.news ?? [];

    const items: NewsItem[] = rawNews.slice(0, 15).map((n) => ({
      title:       n.title ?? "No title",
      summary:     "",
      url:         n.link ?? "#",
      publisher:   n.publisher ?? "Unknown",
      publishedAt: n.providerPublishTime
        ? new Date(n.providerPublishTime * 1000).toISOString()
        : new Date().toISOString(),
      tag:       tagFromTitle(n.title ?? ""),
      sentiment: sentimentFromTitle(n.title ?? ""),
    }));

    cache.set(key, items, TTL.NEWS);
    return items;
  } catch (err) {
    console.error(`[getNews] ${symbol}:`, err);
    return [];
  }
}

// ─── Multiple Quotes ──────────────────────────────────────────────────────────

export async function getMultipleQuotes(symbols: string[]): Promise<StockQuote[]> {
  const results: StockQuote[] = [];
  for (const symbol of symbols) {
    try {
      results.push(await getQuote(symbol));
      await sleep(100);
    } catch (err) {
      console.warn(`[getMultipleQuotes] ${symbol}:`, (err as Error).message);
    }
  }
  return results;
}
