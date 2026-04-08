/**
 * POST /api/stock/[symbol]/setup-analysis
 *
 * Generates an AI interpretation of the user's current chart setup.
 * Receives the exact indicator states from the frontend (what the user sees)
 * and returns a structured setup analysis.
 *
 * Not cached in SQLite — the analysis is specific to the exact combination
 * of indicators/range/interval the user has active. Short in-memory cache
 * keyed by a content hash prevents duplicate calls on rapid re-clicks.
 */

import { NextResponse } from "next/server";
import { cache } from "@/lib/cache";
import { generateSetupAnalysis, getGeminiStatus } from "@/lib/gemini";
import type {
  SetupAnalysisInput,
  SetupAnalysis,
  ActiveIndicatorSnapshot,
  MacroContextPayload,
} from "@/lib/types";
import crypto from "crypto";

/** 5 minute in-memory cache for identical requests */
const CACHE_TTL = 5 * 60_000;

// ─── Bucketing helpers ─────────────────────────────────────────────────────
// Round continuous values into discrete buckets so minor fluctuations
// don't bust the cache while meaningful regime changes do.

/** Round to nearest bucket (e.g. bucket(47.3, 10) → 50) */
function bucket(v: number, size: number): number {
  return Math.round(v / size) * size;
}

/** Compact fingerprint for a single indicator's structured fields */
function indicatorFingerprint(ind: ActiveIndicatorSnapshot): string {
  const s = ind.structured;
  if (!s) return ind.name;

  const parts: string[] = [ind.name];

  if (s.macd) {
    parts.push(`M:${s.macd.crossover}/${s.macd.histogramSign}`);
  }
  if (s.adx) {
    parts.push(`A:${s.adx.trendStrength}/${s.adx.direction}`);
  }
  if (s.stochastic) {
    parts.push(`S:${s.stochastic.zone}/${s.stochastic.crossover}`);
  }
  if (s.bollinger) {
    // Bucket %B by 10 (0,10,20…100) and bandwidth by 1
    parts.push(`B:${bucket(s.bollinger.percentB, 10)}/${bucket(s.bollinger.bandwidth, 1)}`);
  }
  if (s.ichimoku) {
    parts.push(`I:${s.ichimoku.priceVsCloud}/${s.ichimoku.cloudColor ?? "-"}`);
  }
  if (s.movingAverages) {
    parts.push(`MA:${s.movingAverages.alignment}`);
  }
  if (s.fibRetracement) {
    // Bucket nearest level to 2 decimals (already is), distance by $1
    parts.push(`FR:${s.fibRetracement.nearestLevel.toFixed(2)}/${bucket(s.fibRetracement.priceDistance, 1)}`);
  }
  if (s.fibExtension) {
    parts.push(`FE:${s.fibExtension.nearestLevel.toFixed(2)}/${bucket(s.fibExtension.priceDistance, 1)}`);
  }
  if (s.stdDev) {
    // Bucket volatility % by 0.5
    parts.push(`SD:${bucket(s.stdDev.percentOfPrice, 0.5)}`);
  }
  if (s.pitchfork) {
    parts.push(`PF:${s.pitchfork.position}/${s.pitchfork.reverting ? "R" : "-"}/${s.pitchfork.medianSlope}`);
  }

  return parts.join("|");
}

/** Compact fingerprint for the structured macro context */
function macroFingerprint(mc: MacroContextPayload | null): string {
  if (!mc) return "-";

  const parts: string[] = [
    mc.regime,
    mc.confidence,
    String(bucket(mc.confidenceScore, 10)),
    mc.isStale ? "stale" : "fresh",
    mc.policyBias ?? "-",
    mc.volatility?.regime ?? "-",
    mc.breadth ?? "-",
  ];

  // Fear & Greed bucketed by 10 (0-10, 10-20, …)
  if (mc.fearGreed) {
    parts.push(`FG:${bucket(mc.fearGreed.score, 10)}`);
  } else {
    parts.push("FG:-");
  }

  // Stable compact representation of driver arrays:
  // Count + first 40 chars of sorted join — captures meaningful shifts
  // without being sensitive to minor wording changes.
  const driversKey = (arr: string[]) =>
    arr.length === 0 ? "0" : `${arr.length}:${arr.sort().join(";").slice(0, 40)}`;
  parts.push(`b:${driversKey(mc.bullDrivers)}`);
  parts.push(`r:${driversKey(mc.bearDrivers)}`);
  parts.push(`w:${driversKey(mc.watchNext)}`);

  return parts.join("/");
}

function hashInput(input: SetupAnalysisInput): string {
  const key = JSON.stringify({
    s: input.symbol,
    r: input.range,
    i: input.interval,
    t: input.chartType,
    p: Math.round(input.price * 100),
    // Structured indicator fingerprints — captures regime-level changes
    // in each indicator without being sensitive to decimal noise
    a: input.activeIndicators.map(indicatorFingerprint).sort(),
    // Full macro fingerprint — regime, confidence, all derived signals,
    // plus driver/watch arrays in compact form
    m: macroFingerprint(input.macroContext),
  });
  return `setup:${crypto.createHash("md5").update(key).digest("hex").slice(0, 12)}`;
}

export async function POST(
  req: Request,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol.toUpperCase();
  const geminiStatus = getGeminiStatus();

  let input: SetupAnalysisInput;
  try {
    input = await req.json();
    // Normalise symbol
    input.symbol = symbol;
  } catch {
    return NextResponse.json(
      { data: null, error: "Invalid request body" },
      { status: 400 }
    );
  }

  // Validate minimum required fields
  if (!input.price || !input.range || !input.interval) {
    return NextResponse.json(
      { data: null, error: "Missing required fields: price, range, interval" },
      { status: 400 }
    );
  }

  // Check in-memory cache
  const cacheKey = hashInput(input);
  const cached = cache.get<SetupAnalysis>(cacheKey);
  if (cached) {
    return NextResponse.json({
      data: cached,
      error: null,
      source: "cache",
      _debug: { ...geminiStatus, geminiCalled: false },
    });
  }

  try {
    const result = await generateSetupAnalysis(input);
    cache.set(cacheKey, result, CACHE_TTL);

    return NextResponse.json({
      data: result,
      error: null,
      source: result.source === "gemini" ? "generated" : "fallback",
      _debug: { ...geminiStatus, geminiCalled: true },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[setup-analysis/${symbol}]`, errMsg);
    return NextResponse.json(
      { data: null, error: `Failed to generate setup analysis: ${errMsg}` },
      { status: 500 }
    );
  }
}
