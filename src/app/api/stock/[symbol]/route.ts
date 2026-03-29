import { NextResponse } from "next/server";
import * as Finnhub from "@/lib/finnhub";
import * as Yahoo from "@/lib/yahoo-finance";
import { computeIndicators } from "@/lib/calculations";

function useFinnhub() { return !!process.env.FINNHUB_API_KEY; }

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  try {
    const [quote, bars] = await Promise.all([
      useFinnhub() ? Finnhub.getQuote(symbol) : Yahoo.getQuote(symbol),
      useFinnhub() ? Finnhub.getHistoricalData(symbol, 365) : Yahoo.getHistoricalData(symbol, 365),
    ]);
    const indicators = computeIndicators(bars, quote.volume);
    if (!indicators.ma50 && quote.ma50) indicators.ma50 = quote.ma50;
    if (!indicators.ma200 && quote.ma200) indicators.ma200 = quote.ma200;
    return NextResponse.json({ data: { quote, indicators }, error: null });
  } catch (err) {
    console.error(`[stock/${symbol}]`, err);
    return NextResponse.json({ data: null, error: `Failed to fetch data for ${symbol}` }, { status: 500 });
  }
}
