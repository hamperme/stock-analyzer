import { NextResponse } from "next/server";
import { getNews } from "@/lib/yahoo-finance";

export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol.toUpperCase();

  try {
    const news = await getNews(symbol);
    return NextResponse.json({ data: news, error: null });
  } catch (err) {
    console.error(`[news/${symbol}]`, err);
    return NextResponse.json(
      { data: null, error: `Failed to fetch news for ${symbol}` },
      { status: 500 }
    );
  }
}
