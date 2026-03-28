/**
 * Yahoo Finance data fetcher — uses Yahoo Finance public APIs directly.
 * No API key required. Data may be delayed ~15 minutes.
 */

import { cache, TTL } from "./cache";
import type { StockQuote, HistoricalBar, NewsItem, NewsTag } from "./types";

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function yfFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Yahoo Finance error ${res.status} for ${url}`);
  return res.json();
}

// ─── Quote ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseQuote(raw: any, symbol: string): StockQuote {
  const r = raw?.quoteSummary?.result?.[0];
  const p = r?.price ?? {};
  const s = r?.summaryDetail ?? {};
  const k = r?.defaultKeyStatistics ?? {};

  return {
    symbol: p.symbol ?? symbol,
    shortName: p.shortName ?? symbol,
    longName: p.longName ?? p.shortName ?? symbol,
    price: p.regularMarketPrice?.raw ?? 0,
    previousClose: p.regularMarketPreviousClose?.raw ?? 0,
    change: p.regularMarketChange?.raw ?? 0,
    changePercent: (p.regularMarketChangePercent?.raw ?? 0) * 100,
    volume: p.regularMarketVolume?.raw ?? 0,
    avgVolume: p.averageVolume?.raw ?? p.averageVolume10days?.raw ?? 0,
    marketCap: p.marketCap?.raw ?? null,
    fiftyTwoWeekHigh: s.fiftyTwoWeekHigh?.raw ?? 0,
    fiftyTwoWeekLow: s.fiftyTwoWeekLow?.raw ?? 0,
    ma50: s.fiftyDayAverage?.raw ?? 0,
    ma200: s.twoHundredDayAverage?.raw ?? 0,
    beta: s.beta?.raw ?? k.beta?.raw ?? null,
    currency: p.currency ?? "USD",
  };
}

export async function getQuote(symbol: string): Promise<StockQuote> {
  const key = `quote:${symbol}`;
  const cached = cache.get<StockQuote>(key);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(
    symbol
  )}?modules=price,summaryDetail,defaultKeyStatistics`;

  const raw = await yfFetch(url);
  const quote = parseQuote(raw, symbol);
  cache.set(key, quote, TTL.QUOTE);
  return quote;
}

// ─── Historical Data ──────────────────────────────────────────────────────────

export async function getHistoricalData(
  symbol: string,
  days = 365
): Promise<HistoricalBar[]> {
  const key = `history:${symbol}:${days}`;
  const cached = cache.get<HistoricalBar[]>(key);
  if (cached) return cached;

  const range = days <= 30 ? "1mo" : days <= 90 ? "3mo" : days <= 180 ? "6mo" : days <= 365 ? "1y" : "2y";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=${range}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await yfFetch(url)) as any;
  const result = raw?.chart?.result?.[0];

  if (!result) throw new Error(`No chart data for ${symbol}`);

  const timestamps: number[] = result.timestamp ?? [];
  const ohlcv = result.indicators?.quote?.[0] ?? {};
  const opens: number[] = ohlcv.open ?? [];
  const highs: number[] = ohlcv.high ?? [];
  const lows: number[] = ohlcv.low ?? [];
  const closes: number[] = ohlcv.close ?? [];
  const volumes: number[] = ohlcv.volume ?? [];

  const bars: HistoricalBar[] = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split("T")[0],
      open: Math.round((opens[i] ?? 0) * 100) / 100,
      high: Math.round((highs[i] ?? 0) * 100) / 100,
      low: Math.round((lows[i] ?? 0) * 100) / 100,
      close: Math.round((closes[i] ?? 0) * 100) / 100,
      volume: volumes[i] ?? 0,
    }))
    .filter((b) => b.close > 0);

  cache.set(key, bars, TTL.HISTORY);
  return bars;
}

// ─── News ─────────────────────────────────────────────────────────────────────

const TAG_PATTERNS: Array<{ pattern: RegExp; tag: NewsTag }> = [
  { pattern: /earnings|revenue|profit|eps|guidance|forecast|quarter/i, tag: "Earnings" },
  { pattern: /launch|release|announce|unveil|introduce|new product/i, tag: "Product Launch" },
  { pattern: /lawsuit|sec|investigation|fine|penalty|regulatory|compliance/i, tag: "Legal" },
  { pattern: /partner|deal|agreement|collaboration|joint venture/i, tag: "Partnership" },
  { pattern: /analyst|rating|upgrade|downgrade|price target|outperform/i, tag: "Analyst Rating" },
  { pattern: /ceo|cfo|cto|resign|appoint|hire|executive|board/i, tag: "Executive Change" },
  { pattern: /market|economy|fed|interest rate|inflation|gdp/i, tag: "Market Sentiment" },
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
      title?: string;
      link?: string;
      publisher?: string;
      providerPublishTime?: number;
    }> = json?.finance?.result?.[0]?.news ?? json?.news ?? [];

    const items: NewsItem[] = rawNews.slice(0, 15).map((n) => ({
      title: n.title ?? "No title",
      summary: "",
      url: n.link ?? "#",
      publisher: n.publisher ?? "Unknown",
      publishedAt: n.providerPublishTime
        ? new Date(n.providerPublishTime * 1000).toISOString()
        : new Date().toISOString(),
      tag: tagFromTitle(n.title ?? ""),
      sentiment: sentimentFromTitle(n.title ?? ""),
    }));

    cache.set(key, items, TTL.NEWS);
    return items;
  } catch (err) {
    console.error(`[getNews] ${symbol}:`, err);
    return [];
  }
}

// ─── Multiple Quotes (Parallel) ───────────────────────────────────────────────

export async function getMultipleQuotes(symbols: string[]): Promise<StockQuote[]> {
  const results = await Promise.allSettled(symbols.map((s) => getQuote(s)));
  return results
    .filter((r): r is PromiseFulfilledResult<StockQuote> => r.status === "fulfilled")
    .map((r) => r.value);
}
