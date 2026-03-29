import { NextResponse } from "next/server";
import { getQuote } from "@/lib/finnhub";
import { getHistoricalData as getYahooHistory, getHistoricalDataSpark } from "@/lib/yahoo-finance";
import { getHistoricalData as getTwelveHistory } from "@/lib/twelvedata";
import { computeIndicators } from "@/lib/calculations";
import type { HistoricalBar, TechnicalIndicators } from "@/lib/types";

/** Minimal indicators when no history is available (Finnhub quote-only). */
function fallbackIndicators(price: number): TechnicalIndicators {
  return {
    rsi: 50,
    relativeVolume: 1,
    trendRegime: "Sideways",
    ma20: price,
    ma50: price,
    ma200: price,
    priceVsMa50Pct: 0,
    priceVsMa200Pct: 0,
    setupScore: 0,
    setupLabel: "Neutral",
    high52w: price,
    low52w: price,
    distFrom52wHighPct: 0,
  };
}

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  try {
    // Always get real-time quote from Finnhub (reliable)
    const quote = await getQuote(symbol);

    // Waterfall: Yahoo v8 → Yahoo Spark → Twelve Data
    let bars: HistoricalBar[] = [];
    try {
      bars = await getYahooHistory(symbol, 365);
    } catch {
      try {
        bars = await getHistoricalDataSpark(symbol, 365);
      } catch {
        try { bars = await getTwelveHistory(symbol, 365); } catch { /* use fallback indicators */ }
      }
    }

    const hasHistory = bars.length >= 15;
    const indicators = hasHistory
      ? computeIndicators(bars, quote.volume || undefined)
      : fallbackIndicators(quote.price);

    return NextResponse.json({ data: { quote, indicators, hasHistory }, error: null });
  } catch (err) {
    console.error(`[stock/${symbol}]`, err);
    return NextResponse.json({ data: null, error: `Failed to fetch data for ${symbol}` }, { status: 500 });
  }
}
