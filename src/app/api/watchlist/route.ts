import { NextResponse } from "next/server";
import { getMultipleQuotes, getHistoricalData } from "@/lib/yahoo-finance";
import { calculateRSI, calculateRelativeVolume, calculateSetupScore } from "@/lib/calculations";
import type { WatchlistEntry } from "@/lib/types";

const DEFAULT_SYMBOLS = "AAPL,MSFT,GOOGL,NVDA,AMZN,META,TSLA,JPM,V,UNH";

function getSymbols(): string[] {
  const raw = process.env.WATCHLIST_SYMBOLS ?? DEFAULT_SYMBOLS;
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export async function GET() {
  try {
    const symbols = getSymbols();

    // Fetch quotes and history in parallel
    const [quotes, ...historyResults] = await Promise.allSettled([
      getMultipleQuotes(symbols),
      ...symbols.map((s) => getHistoricalData(s, 60)), // 60 days for RSI + relVol
    ]);

    if (quotes.status !== "fulfilled") {
      return NextResponse.json({ error: "Failed to fetch quotes" }, { status: 500 });
    }

    const entries: WatchlistEntry[] = quotes.value.map((quote, idx) => {
      const histResult = historyResults[idx];
      const bars = histResult.status === "fulfilled" ? histResult.value : [];
      const closes = bars.map((b) => b.close);
      const volumes = bars.map((b) => b.volume);

      const rsi = calculateRSI(closes);
      const relativeVolume = calculateRelativeVolume(
        volumes.slice(0, -1),
        quote.volume || volumes[volumes.length - 1] || 0
      );

      const ma50 = quote.ma50 || 0;
      const ma200 = quote.ma200 || 0;
      const price = quote.price;

      const maAlignment =
        ma50 > ma200 && price > ma50
          ? "bullish"
          : ma50 < ma200 && price < ma50
          ? "bearish"
          : "mixed";

      // Use a simplified MA20 from history
      const ma20 =
        closes.length >= 20
          ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
          : price;

      const setupScore = calculateSetupScore({
        price,
        ma20,
        ma50,
        ma200,
        rsi,
        relativeVolume,
      });

      const setupLabel =
        setupScore >= 80
          ? "Strong Setup"
          : setupScore >= 60
          ? "Watch"
          : setupScore >= 40
          ? "Neutral"
          : "Avoid";

      return {
        symbol: quote.symbol,
        shortName: quote.shortName,
        price: quote.price,
        change: Math.round(quote.change * 100) / 100,
        changePercent: Math.round(quote.changePercent * 100) / 100,
        volume: quote.volume,
        relativeVolume,
        ma50,
        ma200,
        maAlignment,
        rsi,
        setupScore,
        setupLabel,
      } satisfies WatchlistEntry;
    });

    return NextResponse.json({ data: entries, error: null });
  } catch (err) {
    console.error("[watchlist]", err);
    return NextResponse.json(
      { data: null, error: "Failed to load watchlist" },
      { status: 500 }
    );
  }
}
