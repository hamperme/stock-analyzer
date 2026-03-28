import { NextResponse } from "next/server";
import { getQuote, getHistoricalData } from "@/lib/yahoo-finance";
import { calculateRSI, calculateRelativeVolume, calculateSetupScore, lastSMA } from "@/lib/calculations";
import type { WatchlistEntry } from "@/lib/types";

const DEFAULT_SYMBOLS = "AAPL,MSFT,GOOGL,NVDA,AMZN,META,TSLA,JPM,V,UNH";

function getSymbols(): string[] {
  const raw = process.env.WATCHLIST_SYMBOLS ?? DEFAULT_SYMBOLS;
  return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buildEntry(symbol: string): Promise<WatchlistEntry> {
  const [quote, bars] = await Promise.all([
    getQuote(symbol),
    getHistoricalData(symbol, 60),
  ]);

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  const rsi = calculateRSI(closes);
  const relativeVolume = calculateRelativeVolume(
    volumes.slice(0, -1),
    quote.volume > 0 ? quote.volume : (volumes[volumes.length - 1] ?? 0)
  );

  const ma20  = lastSMA(closes, 20)  || quote.price;
  const ma50  = lastSMA(closes, 50)  || quote.ma50  || quote.price;
  const ma200 = lastSMA(closes, 200) || quote.ma200 || quote.price;
  const price = quote.price;

  const maAlignment =
    ma50 > 0 && ma200 > 0
      ? ma50 > ma200 && price > ma50 ? "bullish"
      : ma50 < ma200 && price < ma50 ? "bearish"
      : "mixed"
    : "mixed";

  const setupScore = calculateSetupScore({ price, ma20, ma50, ma200, rsi, relativeVolume });

  const setupLabel =
    setupScore >= 80 ? "Strong Setup" :
    setupScore >= 60 ? "Watch" :
    setupScore >= 40 ? "Neutral" : "Avoid";

  return {
    symbol: quote.symbol,
    shortName: quote.shortName,
    price,
    change: Math.round(quote.change * 100) / 100,
    changePercent: Math.round(quote.changePercent * 100) / 100,
    volume: quote.volume,
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

    // Sequential fetching to stay under Yahoo Finance rate limits
    for (const symbol of symbols) {
      try {
        entries.push(await buildEntry(symbol));
        await sleep(150); // 150ms gap between symbols
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
