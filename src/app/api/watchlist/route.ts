import { NextResponse } from "next/server";
import * as Finnhub from "@/lib/finnhub";
import * as Yahoo from "@/lib/yahoo-finance";
import { calculateRSI, calculateRelativeVolume, calculateSetupScore, lastSMA } from "@/lib/calculations";
import type { WatchlistEntry } from "@/lib/types";

const DEFAULT_SYMBOLS = "AAPL,MSFT,GOOGL,NVDA,AMZN,META,TSLA,JPM,V,UNH";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getSymbols(): string[] {
  const raw = process.env.WATCHLIST_SYMBOLS ?? DEFAULT_SYMBOLS;
  return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function useFinnhub(): boolean {
  return !!process.env.FINNHUB_API_KEY;
}

async function buildEntry(symbol: string): Promise<WatchlistEntry> {
  const bars = useFinnhub()
    ? await Finnhub.getHistoricalData(symbol, 60)
    : await Yahoo.getHistoricalData(symbol, 60);

  const closes  = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  const price     = closes[closes.length - 1];
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : price;
  const change    = Math.round((price - prevClose) * 100) / 100;
  const changePercent = prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;
  const volume    = volumes[volumes.length - 1] ?? 0;

  // For Finnhub, get the real-time quote for accurate price/change
  let realPrice = price;
  let realChange = change;
  let realChangePercent = changePercent;
  let shortName = symbol;

  if (useFinnhub()) {
    try {
      const q = await Finnhub.getQuote(symbol);
      realPrice = q.price || price;
      realChange = q.change;
      realChangePercent = q.changePercent;
      shortName = q.shortName;
    } catch { /* use history values as fallback */ }
  }

  const rsi = calculateRSI(closes);
  const relativeVolume = calculateRelativeVolume(volumes.slice(0, -1), volume);

  const ma20  = lastSMA(closes, 20)  || price;
  const ma50  = lastSMA(closes, 50)  || price;
  const ma200 = lastSMA(closes, 200) || price;

  const maAlignment =
    ma50 > 0 && ma200 > 0
      ? ma50 > ma200 && realPrice > ma50 ? "bullish"
      : ma50 < ma200 && realPrice < ma50 ? "bearish"
      : "mixed"
    : "mixed";

  const setupScore = calculateSetupScore({ price: realPrice, ma20, ma50, ma200, rsi, relativeVolume });
  const setupLabel =
    setupScore >= 80 ? "Strong Setup" :
    setupScore >= 60 ? "Watch" :
    setupScore >= 40 ? "Neutral" : "Avoid";

  return {
    symbol,
    shortName,
    price: realPrice,
    change: realChange,
    changePercent: realChangePercent,
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
    const delay = useFinnhub() ? 100 : 400; // Finnhub allows 60 req/min → 100ms safe

    for (const symbol of symbols) {
      try {
        entries.push(await buildEntry(symbol));
        await sleep(delay);
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
