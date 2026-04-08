/**
 * GET /api/debug/store — inspect SQLite store status.
 */

import { NextResponse } from "next/server";
import { getStoreStatus, loadQuote, loadHistory, loadWatchlist, loadIndices } from "@/lib/store";

export async function GET() {
  const status = getStoreStatus();

  // Sample a few symbols to show freshness
  const samples: Record<string, unknown> = {};
  for (const sym of status.symbols.slice(0, 5)) {
    const q = loadQuote(sym);
    const h = loadHistory(sym);
    samples[sym] = {
      quote: q ? { price: q.data.price, stale: q.stale, ageMin: Math.round(q.ageMs / 60_000) } : null,
      history: h ? { bars: h.data.length, stale: h.stale, ageMin: Math.round(h.ageMs / 60_000) } : null,
    };
  }

  const wl = loadWatchlist();
  const idx = loadIndices();

  return NextResponse.json({
    store: {
      dbPath: status.dbPath,
      exists: status.exists,
      symbolCount: status.symbols.length,
      symbols: status.symbols,
      counts: status.counts,
    },
    meta: status.meta,
    samples,
    watchlist: wl ? { count: wl.data.length, stale: wl.stale, ageMin: Math.round(wl.ageMs / 60_000) } : null,
    indices: idx ? { count: idx.data.length, stale: idx.stale, ageMin: Math.round(idx.ageMs / 60_000) } : null,
  });
}
