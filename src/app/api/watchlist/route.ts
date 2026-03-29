import { NextResponse } from "next/server";
import { getHistoricalData } from "@/lib/yahoo-finance";
import { calculateRSI, calculateRelativeVolume, calculateSetupScore, lastSMA } from "@/lib/calculations";
import type { WatchlistEntry } from "@/lib/types";

const DEFAULT_SYMBOLS = "AAPL,MSFT,GOOGL,NVDA,AMZN,META,TSLA,JPM,V,UNH";

function getSymbols(): string[] {
  const raw = process.env.WATCHLIST_SYMBOLS ?? DEFAULT_SYMBOLS;
  return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buildEntry(symbol: string): Promise<WatchlistEntry> {
  // ONE API call per symbol — history endpoint returns current price in meta too
  const bars = await getHistoricalData(symbol, 60);

  const closes  = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  // Latest values from history
  const price   = closes[closes.length - 1];
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : price;
  const change  = Math.round((price - prevClose) * 100) / 100;
  const changePercent = prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;
  const volume  = volumes[volumes.length - 1] ?? 0;

  const rsi = calculateRSI(closes);
  const relativeVolume = calculateRelativeVolume(volumes.slice(0, -1), volume);

  const ma20  = lastSMA(closes, 20)  || price;
  const ma50  = lastSMA(closes, 50)  || price;
  const ma200 = lastSMA(closes, 200) || price;

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

  // Derive short name from symbol (full name loaded on stock detail page)
  return {
    symbol,
    shortName: symbol,
    price,
    change,
    changePercent,
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
        await sleep(400); // 400ms between symbols — well under Yahoo rate limit
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
