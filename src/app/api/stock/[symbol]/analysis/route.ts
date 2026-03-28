import { NextResponse } from "next/server";
import { getQuote, getHistoricalData, getNews } from "@/lib/yahoo-finance";
import { computeIndicators } from "@/lib/calculations";
import { generateStockAnalysis } from "@/lib/gemini";
import { cache, TTL } from "@/lib/cache";

export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol.toUpperCase();
  const cacheKey = `analysis:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return NextResponse.json({ data: cached, error: null });

  try {
    const [quote, bars, news] = await Promise.all([
      getQuote(symbol),
      getHistoricalData(symbol, 365),
      getNews(symbol),
    ]);

    const indicators = computeIndicators(bars, quote.volume);
    if (!indicators.ma50 && quote.ma50) indicators.ma50 = quote.ma50;
    if (!indicators.ma200 && quote.ma200) indicators.ma200 = quote.ma200;

    const analysis = await generateStockAnalysis({
      symbol: quote.symbol,
      shortName: quote.shortName,
      price: quote.price,
      changePercent: quote.changePercent,
      indicators,
      newsHeadlines: news.map((n) => n.title),
    });

    cache.set(cacheKey, analysis, TTL.ANALYSIS);
    return NextResponse.json({ data: analysis, error: null });
  } catch (err) {
    console.error(`[analysis/${symbol}]`, err);
    return NextResponse.json(
      { data: null, error: `Failed to generate analysis for ${symbol}` },
      { status: 500 }
    );
  }
}
