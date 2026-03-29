import { NextResponse } from "next/server";
import * as Finnhub from "@/lib/finnhub";
import * as Yahoo from "@/lib/yahoo-finance";

function useFinnhub() { return !!process.env.FINNHUB_API_KEY; }

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  try {
    const news = useFinnhub()
      ? await Finnhub.getNews(symbol)
      : await Yahoo.getNews(symbol);
    return NextResponse.json({ data: news, error: null });
  } catch (err) {
    console.error(`[news/${symbol}]`, err);
    return NextResponse.json({ data: null, error: `Failed to fetch news for ${symbol}` }, { status: 500 });
  }
}
