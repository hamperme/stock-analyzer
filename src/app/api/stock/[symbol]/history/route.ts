/**
 * GET /api/stock/[symbol]/history?range=6m&interval=1d
 *
 * Snapshot-first: returns historical bars from SQLite store.
 * Supports range (visible span) and interval (candle granularity).
 *
 * Range options: 1d, 5d, 1m, 3m, 6m, 1y, 2y, all
 * Interval options: 1h, 1d, 1w, 1mo
 *
 * - 1d interval: raw daily bars (stored data)
 * - 1w interval: daily bars aggregated into weekly candles
 * - 1mo interval: daily bars aggregated into monthly candles
 * - 1h interval: only if real intraday data is available (not yet supported)
 *
 * Backwards compatible: ?days=365 still works (maps to range=1y&interval=1d).
 */

import { NextResponse } from "next/server";
import { enrichBarsWithMAs, aggregateWeekly, aggregateMonthly } from "@/lib/calculations";
import { cache, TTL } from "@/lib/cache";
import { loadHistory } from "@/lib/store";
import type { HistoricalBar } from "@/lib/types";

/** Convert a range string like "6m" to a number of calendar days. */
function rangeToDays(range: string): number {
  switch (range.toLowerCase()) {
    case "1d":  return 1;
    case "5d":  return 5;
    case "1m":  return 30;
    case "3m":  return 90;
    case "6m":  return 180;
    case "1y":  return 365;
    case "2y":  return 730;
    case "all": return 99999; // return everything available
    default:    return 180; // default 6m
  }
}

function getBars(symbol: string): { bars: HistoricalBar[]; updatedAt: string | null; stale: boolean; source: string } {
  // 1. In-memory cache
  const sharedKey = `shared:history:${symbol}:1825`;
  const sharedCached = cache.get<HistoricalBar[]>(sharedKey);
  if (sharedCached) {
    return { bars: sharedCached, updatedAt: null, stale: false, source: "cache" };
  }

  // 2. SQLite store
  const stored = loadHistory(symbol);
  if (stored && stored.data.length > 0) {
    cache.set(sharedKey, stored.data, TTL.HISTORY);
    return { bars: stored.data, updatedAt: stored.updatedAt, stale: stored.stale, source: "store" };
  }

  return { bars: [], updatedAt: null, stale: false, source: "empty" };
}

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const { searchParams } = new URL(req.url);

  // Parse params — support both new (range+interval) and legacy (days) format
  const legacyDays = searchParams.get("days");
  const rangeParam = searchParams.get("range") ?? (legacyDays ? null : "6m");
  const intervalParam = (searchParams.get("interval") ?? "1d").toLowerCase();

  const days = legacyDays
    ? Math.min(parseInt(legacyDays, 10), 730)
    : rangeToDays(rangeParam ?? "6m");

  // ── Handle 1h interval ────────────────────────────────────────────────────
  if (intervalParam === "1h") {
    // Intraday data is not currently stored. Do not fake it from daily bars.
    return NextResponse.json({
      data: [],
      error: null,
      intradaySupported: false,
      interval: "1h",
      source: "unsupported",
    });
  }

  // ── Load daily bars ────────────────────────────────────────────────────────
  const { bars: allBars, updatedAt, stale, source } = getBars(symbol);

  if (allBars.length === 0) {
    return NextResponse.json({
      data: [],
      error: `No history for ${symbol} — click Full Refresh to populate.`,
      cachedAt: null,
      stale: false,
      interval: intervalParam,
      source: "empty",
    });
  }

  // Slice to requested range
  const sliced = days < allBars.length ? allBars.slice(-days) : allBars;

  // ── Aggregate if needed ────────────────────────────────────────────────────
  let output: HistoricalBar[];
  switch (intervalParam) {
    case "1w":
      output = aggregateWeekly(sliced);
      break;
    case "1mo":
      output = aggregateMonthly(sliced);
      break;
    case "1d":
    default:
      output = sliced;
      break;
  }

  // Enrich with moving averages
  const enriched = enrichBarsWithMAs(output);

  return NextResponse.json({
    data: enriched,
    error: null,
    cachedAt: updatedAt,
    stale,
    interval: intervalParam,
    intradaySupported: false,
    source,
  });
}
