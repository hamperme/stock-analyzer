import { NextResponse } from "next/server";
import * as Finnhub from "@/lib/finnhub";
import * as Yahoo from "@/lib/yahoo-finance";
import { enrichBarsWithMAs } from "@/lib/calculations";

function useFinnhub() { return !!process.env.FINNHUB_API_KEY; }

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get("days") ?? "365", 10), 730);
  try {
    const bars = useFinnhub()
      ? await Finnhub.getHistoricalData(symbol, days)
      : await Yahoo.getHistoricalData(symbol, days);
    return NextResponse.json({ data: enrichBarsWithMAs(bars), error: null });
  } catch (err) {
    console.error(`[history/${symbol}]`, err);
    return NextResponse.json({ data: null, error: `Failed to fetch history for ${symbol}` }, { status: 500 });
  }
}
