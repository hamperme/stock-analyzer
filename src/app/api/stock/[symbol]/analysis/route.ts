import { NextResponse } from "next/server";
import { getQuote as getFinnhubQuote } from "@/lib/finnhub";
import { getHistoricalData as getYahooHistory, getNews } from "@/lib/yahoo-finance";
import { getHistoricalData as getTwelveHistory } from "@/lib/twelvedata";
import { computeIndicators } from "@/lib/calculations";
import { generateStockAnalysis } from "@/lib/gemini";
import { cache, TTL } from "@/lib/cache";
import type { HistoricalBar, TechnicalIndicators } from "@/lib/types";

function fallbackIndicators(price: number): TechnicalIndicators {
  return {
    rsi: 50, relativeVolume: 1, trendRegime: "Sideways",
    ma20: price, ma50: price, ma200: price,
    priceVsMa50Pct: 0, priceVsMa200Pct: 0,
    setupScore: 0, setupLabel: "Neutral",
    high52w: price, low52w: price, distFrom52wHighPct: 0,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol.toUpperCase();
  const cacheKey = `analysis:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return NextResponse.json({ data: cached, error: null });

  try {
    // Real-time quote from Finnhub + news from Yahoo Finance
    const [quote, news] = await Promise.all([
      getFinnhubQuote(symbol),
      getNews(symbol),
    ]);

    // Try historical data for richer AI context
    let bars: HistoricalBar[] = [];
    try {
      bars = await getYahooHistory(symbol, 365);
    } catch {
      try { bars = await getTwelveHistory(symbol, 365); } catch { /* ok */ }
    }

    const indicators = bars.length >= 15
      ? computeIndicators(bars, quote.volume || undefined)
      : fallbackIndicators(quote.price);

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
