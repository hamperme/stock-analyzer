import { NextResponse } from "next/server";
import { getHistoricalData as getYahooHistory, getHistoricalDataSpark } from "@/lib/yahoo-finance";
import { getHistoricalData as getTwelveHistory } from "@/lib/twelvedata";
import { enrichBarsWithMAs } from "@/lib/calculations";
import type { HistoricalBar } from "@/lib/types";

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get("days") ?? "365", 10), 730);

  try {
    let bars: HistoricalBar[] = [];

    // Waterfall: Yahoo v8 → Yahoo Spark → Twelve Data
    try {
      bars = await getYahooHistory(symbol, days);
    } catch {
      console.warn(`[history/${symbol}] Yahoo v8 failed, trying Spark…`);
      try {
        bars = await getHistoricalDataSpark(symbol, days);
      } catch {
        console.warn(`[history/${symbol}] Spark failed, trying Twelve Data…`);
        bars = await getTwelveHistory(symbol, days);
      }
    }

    return NextResponse.json({ data: enrichBarsWithMAs(bars), error: null });
  } catch (err) {
    console.error(`[history/${symbol}]`, err);
    return NextResponse.json({ data: [], error: `Chart data unavailable for ${symbol}` }, { status: 200 });
  }
}
