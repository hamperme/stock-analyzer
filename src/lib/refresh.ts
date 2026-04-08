/**
 * Batch refresh pipeline.
 *
 * Fetches market data from providers and writes snapshots to SQLite store.
 * Designed to be called from /api/refresh (manual) or a scheduled task.
 *
 * Provider policy:
 *  - Quotes: Finnhub (primary) — works on free tier
 *  - History: Finnhub candles (primary) → Yahoo v8 → Yahoo Spark → Twelve Data
 *    Finnhub candles may return 403 on free tier — if so, waterfall continues.
 *  - News: Finnhub (primary)
 *
 * Rate-limit strategy for history (the heaviest request type):
 *  - Reset Yahoo circuit breakers before each symbol's history attempt
 *  - 3-second gap between history fetches to stay under Yahoo's rate limit
 *  - If a symbol fails history, keep going — other symbols may succeed
 *  - If circuit breaker trips mid-batch, wait for it to clear before continuing
 */

import { getQuote as getFinnhubQuote, getHistoricalData as getFinnhubHistory, getNews as getFinnhubNews } from "./finnhub";
import { getHistoricalData as getYahooHistory, getHistoricalDataSpark, resetCircuitBreakers as resetYahooCBs, getCircuitBreakerStatus } from "./yahoo-finance";
import { getHistoricalData as getTwelveHistory } from "./twelvedata";
import { calculateRSI, calculateRelativeVolume, calculateSetupScore, lastSMA } from "./calculations";
import { cache, TTL } from "./cache";
import * as store from "./store";
import type { HistoricalBar, WatchlistEntry } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_SYMBOLS = "AAPL,MSFT,GOOGL,NVDA,AMZN,META,TSLA,JPM,V,UNH";

export function getWatchlistSymbols(): string[] {
  const raw = process.env.WATCHLIST_SYMBOLS ?? DEFAULT_SYMBOLS;
  return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

export interface RefreshResult {
  success: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  symbols: string[];
  results: Record<string, {
    quote: boolean;
    history: boolean;
    historySource: string | null;
    news: boolean;
    errors: string[];
  }>;
  watchlistBuilt: boolean;
  totalErrors: number;
}

/**
 * Wait for Yahoo circuit breakers to clear, or reset them if the wait is short.
 * Returns true if we cleared them, false if we timed out.
 */
async function ensureYahooReady(): Promise<void> {
  const status = getCircuitBreakerStatus();
  if (!status.v8Blocked && !status.sparkBlocked) return;

  // If breakers are active, the block is ≤60s. Just reset them — the inter-symbol
  // delay already gives Yahoo time to recover, and we don't want a single symbol's
  // 429 to doom all subsequent symbols.
  console.log("[refresh] Resetting Yahoo circuit breakers before next history fetch");
  resetYahooCBs();
  // Small additional pause to let Yahoo cool down
  await sleep(3000);
}

/**
 * Fetch history for a symbol using full provider waterfall.
 * Finnhub candles (primary) → Yahoo v8 → Yahoo Spark → Twelve Data.
 */
async function fetchHistoryFromProviders(
  symbol: string,
  days = 1825
): Promise<{ bars: HistoricalBar[]; source: string | null }> {
  const errors: string[] = [];

  // 1. Finnhub candles (primary — try first, even if it may 403)
  try {
    const bars = await getFinnhubHistory(symbol, days);
    if (bars.length > 0) {
      cache.set(`shared:history:${symbol}:1825`, bars, TTL.HISTORY);
      return { bars, source: "finnhub" };
    }
  } catch (e) {
    errors.push(`finnhub: ${(e as Error).message}`);
  }

  // 2. Ensure Yahoo circuit breakers are clear before attempting Yahoo
  await ensureYahooReady();

  // 3. Yahoo v8 (primary fallback — full OHLCV)
  try {
    const bars = await getYahooHistory(symbol, days);
    if (bars.length > 0) {
      cache.set(`shared:history:${symbol}:1825`, bars, TTL.HISTORY);
      return { bars, source: "yahoo-v8" };
    }
  } catch (e) {
    errors.push(`yahoo-v8: ${(e as Error).message}`);
  }

  // Extra pause between Yahoo attempts
  await sleep(2000);

  // 4. Yahoo Spark (close-only fallback)
  try {
    // Reset again in case v8 tripped the breaker
    resetYahooCBs();
    const bars = await getHistoricalDataSpark(symbol, days);
    if (bars.length > 0) {
      cache.set(`shared:history:${symbol}:1825`, bars, TTL.HISTORY);
      return { bars, source: "yahoo-spark" };
    }
  } catch (e) {
    errors.push(`yahoo-spark: ${(e as Error).message}`);
  }

  // 5. Twelve Data (if configured)
  if (process.env.TWELVEDATA_API_KEY) {
    try {
      const bars = await getTwelveHistory(symbol, days);
      if (bars.length > 0) {
        cache.set(`shared:history:${symbol}:1825`, bars, TTL.HISTORY);
        return { bars, source: "twelvedata" };
      }
    } catch (e) {
      errors.push(`twelvedata: ${(e as Error).message}`);
    }
  }

  console.warn(`[refresh/${symbol}] All history providers failed:`, errors.join(" | "));
  return { bars: [], source: null };
}

/**
 * Build a WatchlistEntry from stored quote + history data.
 */
function buildWatchlistEntry(symbol: string): WatchlistEntry | null {
  const q = store.loadQuote(symbol);
  const h = store.loadHistory(symbol);
  if (!q) return null;

  const quote = q.data;
  const bars = h?.data ?? [];
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const volume = volumes[volumes.length - 1] ?? 0;
  const price = quote.price;

  const rsi = closes.length >= 15 ? calculateRSI(closes) : 50;
  const relativeVolume = volumes.length >= 2
    ? calculateRelativeVolume(volumes.slice(0, -1), volume)
    : 1;

  const ma20  = closes.length >= 20  ? (lastSMA(closes, 20)  ?? price) : price;
  const ma50  = closes.length >= 50  ? (lastSMA(closes, 50)  ?? price) : price;
  const ma200 = closes.length >= 200 ? (lastSMA(closes, 200) ?? price) : price;

  const maAlignment =
    closes.length >= 50 && ma50 > 0 && ma200 > 0
      ? ma50 > ma200 && price > ma50 ? "bullish"
      : ma50 < ma200 && price < ma50 ? "bearish"
      : "mixed"
      : "mixed";

  const setupScore = closes.length >= 20
    ? calculateSetupScore({ price, ma20, ma50, ma200, rsi, relativeVolume })
    : 0;

  const setupLabel =
    setupScore >= 80 ? "Strong Setup" :
    setupScore >= 60 ? "Watch" :
    setupScore >= 40 ? "Neutral" : "Avoid";

  return {
    symbol,
    shortName: quote.shortName,
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    volume,
    relativeVolume,
    ma50:  Math.round(ma50  * 100) / 100,
    ma200: Math.round(ma200 * 100) / 100,
    maAlignment,
    rsi,
    setupScore,
    setupLabel,
  };
}

/**
 * Run a full refresh for all watchlist symbols.
 *
 * Phase 1: Fetch all quotes from Finnhub (fast, ≤500ms gap)
 * Phase 2: Fetch all history from providers (slow, 3s gap to avoid Yahoo 429)
 * Phase 3: Fetch all news from Finnhub (fast, ≤500ms gap)
 * Phase 4: Build watchlist snapshot from stored data
 */
export async function runFullRefresh(
  options: { symbols?: string[]; skipHistory?: boolean; skipNews?: boolean } = {}
): Promise<RefreshResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const symbols = options.symbols ?? getWatchlistSymbols();
  const results: RefreshResult["results"] = {};
  let totalErrors = 0;
  const meta = store.loadMeta();

  // Initialize result entries
  for (const symbol of symbols) {
    results[symbol] = { quote: false, history: false, historySource: null, news: false, errors: [] };
  }

  // ── Phase 1: Quotes (Finnhub — fast, no heavy rate limiting) ──────────────
  console.log("[refresh] Phase 1: Fetching quotes for", symbols.length, "symbols");
  for (const symbol of symbols) {
    try {
      const quote = await getFinnhubQuote(symbol);
      store.saveQuote(symbol, quote);
      results[symbol].quote = true;
    } catch (e) {
      results[symbol].errors.push(`quote: ${(e as Error).message}`);
      totalErrors++;
    }
    await sleep(500);
  }

  // ── Phase 2: History (heavy — needs careful rate limiting) ────────────────
  if (!options.skipHistory) {
    console.log("[refresh] Phase 2: Fetching history for", symbols.length, "symbols");

    // Reset Yahoo breakers at the start of the history phase
    resetYahooCBs();

    for (const symbol of symbols) {
      try {
        const { bars, source } = await fetchHistoryFromProviders(symbol, 1825);
        if (bars.length > 0) {
          store.saveHistory(symbol, bars);
          results[symbol].history = true;
          results[symbol].historySource = source;
          console.log(`[refresh] ${symbol} history: ${bars.length} bars from ${source}`);
        } else {
          results[symbol].errors.push("history: all providers returned empty");
          totalErrors++;
        }
      } catch (e) {
        results[symbol].errors.push(`history: ${(e as Error).message}`);
        totalErrors++;
      }

      // 3-second gap between symbols — Yahoo needs breathing room
      // This means 10 symbols takes ~30s for history, which is fine for a batch job
      await sleep(3000);
    }
  } else {
    for (const symbol of symbols) {
      results[symbol].history = true; // skipped = OK
    }
  }

  // ── Phase 3: News (Finnhub — fast) ────────────────────────────────────────
  if (!options.skipNews) {
    console.log("[refresh] Phase 3: Fetching news for", symbols.length, "symbols");
    for (const symbol of symbols) {
      try {
        const news = await getFinnhubNews(symbol);
        store.saveNews(symbol, news);
        results[symbol].news = true;
      } catch (e) {
        results[symbol].errors.push(`news: ${(e as Error).message}`);
        totalErrors++;
      }
      await sleep(500);
    }
  } else {
    for (const symbol of symbols) {
      results[symbol].news = true;
    }
  }

  // ── Phase 4: Build watchlist snapshot from stored data ─────────────────────
  let watchlistBuilt = false;
  try {
    const entries: WatchlistEntry[] = [];
    for (const symbol of symbols) {
      const wEntry = buildWatchlistEntry(symbol);
      if (wEntry) entries.push(wEntry);
    }
    if (entries.length > 0) {
      store.saveWatchlist(entries);
      watchlistBuilt = true;
    }
  } catch (e) {
    meta.errors.push({ time: new Date().toISOString(), message: `watchlist build: ${(e as Error).message}` });
    totalErrors++;
  }

  const completedAt = new Date().toISOString();
  meta.lastFullRefresh = completedAt;
  meta.lastQuoteRefresh = completedAt;
  if (!options.skipHistory) meta.lastHistoryRefresh = completedAt;
  meta.lastWatchlistRefresh = completedAt;

  // Log errors to meta
  for (const [sym, r] of Object.entries(results)) {
    for (const err of r.errors) {
      meta.errors.push({ time: completedAt, message: `${sym}: ${err}` });
    }
  }
  store.saveMeta(meta);

  return {
    success: totalErrors === 0,
    startedAt,
    completedAt,
    durationMs: Date.now() - start,
    symbols,
    results,
    watchlistBuilt,
    totalErrors,
  };
}

/**
 * Quick refresh — only quotes (fast, low API cost).
 */
export async function runQuoteRefresh(symbols?: string[]): Promise<{ updated: string[]; errors: string[] }> {
  const syms = symbols ?? getWatchlistSymbols();
  const updated: string[] = [];
  const errors: string[] = [];

  for (const symbol of syms) {
    try {
      const quote = await getFinnhubQuote(symbol);
      store.saveQuote(symbol, quote);
      updated.push(symbol);
    } catch (e) {
      errors.push(`${symbol}: ${(e as Error).message}`);
    }
    await sleep(600);
  }

  // Rebuild watchlist with new quotes
  try {
    const allSyms = getWatchlistSymbols();
    const entries: WatchlistEntry[] = [];
    for (const sym of allSyms) {
      const wEntry = buildWatchlistEntry(sym);
      if (wEntry) entries.push(wEntry);
    }
    if (entries.length > 0) store.saveWatchlist(entries);
  } catch { /* best effort */ }

  const meta = store.loadMeta();
  meta.lastQuoteRefresh = new Date().toISOString();
  store.saveMeta(meta);

  return { updated, errors };
}
