import { NextResponse } from "next/server";
import { getHistoricalData as getYahooHistory } from "@/lib/yahoo-finance";
import { getHistoricalData as getTwelveHistory } from "@/lib/twelvedata";
import { enrichBarsWithMAs } from "@/lib/calculations";
import type { HistoricalBar } from "@/lib/types";

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get("days") ?? "365", 10), 730);

  try {
    let bars: HistoricalBar[] = [];

    // Try Yahoo Finance first, fall back to Twelve Data
    try {
      bars = await getYahooHistory(symbol, days);
    } catch (yahooErr) {
      console.warn(`[history/${symbol}] Yahoo failed (${(yahooErr as Error).message}), trying Twelve Data…`);
      bars = await getTwelveHistory(symbol, days);
    }

    return NextResponse.json({ data: enrichBarsWithMAs(bars), error: null });
  } catch (err) {
    console.error(`[history/${symbol}]`, err);
    return NextResponse.json({ data: [], error: `Chart data unavailable for ${symbol}` }, { status: 200 });
  }
}
