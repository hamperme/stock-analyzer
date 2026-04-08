/**
 * GET /api/stock/[symbol]/news
 *
 * Snapshot-first: returns news from SQLite store.
 * If nothing stored, does a one-time Finnhub fetch (news is lightweight).
 */

import { NextResponse } from "next/server";
import * as Finnhub from "@/lib/finnhub";
import { loadNews, saveNews } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();

  // 1. Read from store
  const stored = loadNews(symbol);
  if (stored && stored.data.length > 0) {
    return NextResponse.json({
      data: stored.data,
      error: null,
      cachedAt: stored.updatedAt,
      stale: stored.stale,
      source: "store",
    });
  }

  // 2. One-time seed fetch (news is lightweight and doesn't trigger rate limits)
  try {
    const news = await Finnhub.getNews(symbol);
    if (news.length > 0) saveNews(symbol, news);
    return NextResponse.json({ data: news, error: null, source: "live-seed" });
  } catch (err) {
    console.error(`[news/${symbol}]`, err);
    return NextResponse.json({
      data: [],
      error: `No news for ${symbol} — run Full Refresh.`,
      source: "empty",
    });
  }
}
