/**
 * GET /api/watchlist
 *
 * Snapshot-first: returns precomputed watchlist from SQLite store.
 * NEVER makes live provider calls — page loads must be instant and free.
 * If the store is empty, returns an empty list with a hint to run /api/refresh.
 */

import { NextResponse } from "next/server";
import { loadWatchlist } from "@/lib/store";

export async function GET() {
  const stored = loadWatchlist();

  if (stored && stored.data.length > 0) {
    return NextResponse.json({
      data: stored.data,
      error: null,
      cachedAt: stored.updatedAt,
      stale: stored.stale,
      source: "store",
    });
  }

  // Store is empty — no live fallback, just tell the client to refresh
  return NextResponse.json({
    data: [],
    error: "No watchlist data yet — click Full Refresh to populate.",
    cachedAt: null,
    stale: false,
    source: "empty",
  });
}
