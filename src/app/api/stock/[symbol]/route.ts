/**
 * GET /api/stock/[symbol]
 *
 * Snapshot-first: returns quote + indicators from SQLite store.
 * NEVER makes live provider calls on a normal page load.
 * If the symbol isn't in the store, does a one-time live fetch to seed it,
 * but only for the quote — history is read from store or returned empty.
 */

import { NextResponse } from "next/server";
import { getQuote } from "@/lib/finnhub";
import { computeIndicators } from "@/lib/calculations";
import { loadQuote, loadHistory, saveQuote } from "@/lib/store";
import type { TechnicalIndicators } from "@/lib/types";

function fallbackIndicators(price: number): TechnicalIndicators {
  return {
    rsi: 50, relativeVolume: 1, trendRegime: "Sideways",
    ma20: price, ma50: price, ma200: price,
    priceVsMa50Pct: 0, priceVsMa200Pct: 0,
    setupScore: 0, setupLabel: "Neutral",
    high52w: price, low52w: price, distFrom52wHighPct: 0,
  };
}

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();

  // 1. Read from store (instant, no API traffic)
  const storedQuote = loadQuote(symbol);
  const storedHistory = loadHistory(symbol);

  if (storedQuote) {
    const bars = storedHistory?.data ?? [];
    const hasHistory = bars.length >= 15;
    const indicators = hasHistory
      ? computeIndicators(bars, storedQuote.data.volume || undefined)
      : fallbackIndicators(storedQuote.data.price);

    return NextResponse.json({
      data: { quote: storedQuote.data, indicators, hasHistory },
      error: null,
      cachedAt: storedQuote.updatedAt,
      stale: storedQuote.stale,
      source: "store",
    });
  }

  // 2. Symbol not in store — do a lightweight one-time quote fetch to seed it.
  //    This is the ONLY live call a page route ever makes, and only for unknown symbols.
  try {
    const quote = await getQuote(symbol);
    saveQuote(symbol, quote);

    const bars = storedHistory?.data ?? [];
    const hasHistory = bars.length >= 15;
    const indicators = hasHistory
      ? computeIndicators(bars, quote.volume || undefined)
      : fallbackIndicators(quote.price);

    return NextResponse.json({
      data: { quote, indicators, hasHistory },
      error: hasHistory ? null : "No history data yet — run a Full Refresh to populate.",
      cachedAt: new Date().toISOString(),
      stale: false,
      source: "live-seed",
    });
  } catch (err) {
    console.error(`[stock/${symbol}]`, err);
    return NextResponse.json(
      { data: null, error: `No data for ${symbol} — run Full Refresh first, or try again.` },
      { status: 404 }
    );
  }
}
