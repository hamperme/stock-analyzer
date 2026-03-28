import { NextResponse } from "next/server";
import { getHistoricalData } from "@/lib/yahoo-finance";
import { enrichBarsWithMAs } from "@/lib/calculations";

export async function GET(
  req: Request,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol.toUpperCase();
  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get("days") ?? "365", 10), 730);

  try {
    const bars = await getHistoricalData(symbol, days);
    const enriched = enrichBarsWithMAs(bars);
    return NextResponse.json({ data: enriched, error: null });
  } catch (err) {
    console.error(`[history/${symbol}]`, err);
    return NextResponse.json(
      { data: null, error: `Failed to fetch history for ${symbol}` },
      { status: 500 }
    );
  }
}
