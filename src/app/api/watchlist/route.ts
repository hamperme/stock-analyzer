import { NextResponse } from "next/server";
import { getQuote } from "@/lib/finnhub";
import { getHistoricalData as getYahooHistory } from "@/lib/yahoo-finance";
import { getHistoricalData as getTwelveHistory } from "@/lib/twelvedata";
import { calculateRSI, calculateRelativeVolume, calculateSetupScore, lastSMA } from "@/lib/calculations";
import type { WatchlistEntry, HistoricalBar } from "@/lib/types";

const DEFAULT_SYMBOLS = "AAPL,MSFT,GOOGL,NVDA,AMZN,META,TSLA,JPM,V,UNH";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getSymbols(): string[] {
  const raw = process.env.WATCHLIST_SYMBOLS ?? DEFAULT_SYMBOLS;
  return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

async function buildEntry(symbol: string): Promise<WatchlistEntry> {
  // Get real-time quote from Finnhub (reliable, not rate-limited)
  const quote = await getQuote(symbol);

  // Try historical data for RSI/MA: Yahoo Finance first, Twelve Data as fallback.
  // If both fail we still return a useful entry with just the real-time data.
  let bars: HistoricalBar[] = [];
  try {
    bars = await getYahooHistory(symbol, 60);
  } catch (yahooErr) {
    const msg = (yahooErr as Error).message;
    console.warn(`[watchlist] ${symbol} Yahoo history unavailable (${msg}), trying Twelve Data…`);
    try {
      bars = await getTwelveHistory(symbol, 60);
    } catch (tdErr) {
      console.warn(`[watchlist] ${symbol} Twelve Data also unavailable:`, (tdErr as Error).message);
    }
  }

  const closes  = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const volume  = volumes[volumes.length - 1] ?? 0;

  const price = quote.price;

  // Compute indicators only if we have enough history
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

export async function GET() {
  try {
    const symbols = getSymbols();
    const entries: WatchlistEntry[] = [];

    for (const symbol of symbols) {
      try {
        entries.push(await buildEntry(symbol));
        await sleep(200); // Finnhub: 60 req/min (2 calls/symbol = 120/min max, stay under)
      } catch (err) {
        console.warn(`[watchlist] ${symbol} skipped:`, (err as Error).message);
      }
    }

    return NextResponse.json({ data: entries, error: null });
  } catch (err) {
    console.error("[watchlist]", err);
    return NextResponse.json({ data: null, error: "Failed to load watchlist" }, { status: 500 });
  }
}
