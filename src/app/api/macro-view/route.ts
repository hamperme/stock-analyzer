/**
 * GET /api/macro-view
 *
 * Returns a bull-vs-bear macro market synthesis driven by a structured
 * MacroSnapshot (treasury yields, VIX, DXY, oil, indices, breadth, etc.).
 *
 * Data flow:
 *   1. In-memory cache → instant return
 *   2. SQLite store → return if fresh (< 4 hours)
 *   3. Build MacroSnapshot (fetches macro instruments + gathers store data)
 *   4. Send snapshot to Gemini for synthesis (or rule-based fallback)
 *   5. Persist result → return
 *
 * Graceful degradation:
 *   - Each macro instrument fails independently
 *   - Missing inputs lower confidence but don't block synthesis
 *   - Stale stored data is returned rather than empty on generation failure
 */

import { NextResponse } from "next/server";
import { cache, TTL } from "@/lib/cache";
import { loadMacroView, saveMacroView } from "@/lib/store";
import { buildMacroSnapshot } from "@/lib/macro-data";
import { generateMacroView } from "@/lib/gemini";
import type { MacroView } from "@/lib/types";

const CACHE_KEY = "macro:view";

export async function GET() {
  // 1. In-memory cache
  const memCached = cache.get<MacroView>(CACHE_KEY);
  if (memCached) {
    return NextResponse.json({ data: memCached, error: null, source: "cache" });
  }

  // 2. SQLite store — return if fresh enough
  const stored = loadMacroView();
  if (stored && !stored.stale) {
    cache.set(CACHE_KEY, stored.data, TTL.MACRO_VIEW);
    return NextResponse.json({
      data: stored.data,
      error: null,
      cachedAt: stored.updatedAt,
      stale: false,
      source: "store",
    });
  }

  // 3. Build structured macro snapshot + generate synthesis
  try {
    const snapshot = await buildMacroSnapshot();
    const view = await generateMacroView(snapshot);

    // Persist
    saveMacroView(view);
    cache.set(CACHE_KEY, view, TTL.MACRO_VIEW);

    return NextResponse.json({
      data: view,
      error: null,
      cachedAt: view.generatedAt,
      stale: false,
      source: view.source === "gemini" ? "gemini" : "fallback",
    });
  } catch (err) {
    console.error("[macro-view]", err);

    // If we have stale data, return it rather than nothing
    if (stored) {
      cache.set(CACHE_KEY, stored.data, TTL.MACRO_VIEW);
      return NextResponse.json({
        data: stored.data,
        error: null,
        cachedAt: stored.updatedAt,
        stale: true,
        source: "store-stale",
      });
    }

    return NextResponse.json(
      { data: null, error: "Failed to generate macro view — run Full Refresh first to populate market data." },
      { status: 500 }
    );
  }
}
