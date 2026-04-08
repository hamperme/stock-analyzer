/**
 * Macro market data fetcher & snapshot builder.
 *
 * Fetches structured macro inputs from Yahoo Finance and assembles them
 * into a normalised MacroSnapshot with:
 *   1. Objective market state (instrument readings)
 *   2. Derived regime signals (policy path, curve, breadth)
 *   3. Narrative inputs (headlines, movers)
 *   4. Metadata (confidence, input signals, freshness)
 *
 * Every instrument is fetched independently — a failure in one does not
 * block others. Confidence scoring reflects actual input coverage.
 *
 * Future integration points:
 *   - FRED API for official rates / macro series (GDP, CPI, payrolls)
 *   - CME FedWatch for market-implied rate path
 *   - NYSE breadth (advance/decline line) for true market-wide breadth
 */

import https from "https";
import { cache, TTL } from "./cache";
import { loadIndices, loadWatchlist, loadNews, loadMacroSnapshot, saveMacroSnapshot } from "./store";
import { getWatchlistSymbols } from "./refresh";
import type {
  MacroDataPoint,
  MacroSnapshot,
  FearGreedData,
  PolicyContext,
  BreadthReading,
  ConfidenceMeta,
  InputSignal,
} from "./types";

// ─── Yahoo Finance instrument definitions ────────────────────────────────────

type SnapshotInstrumentKey = "treasury2Y" | "treasury10Y" | "treasury3M" | "vix" | "dxy" | "oil";

interface MacroInstrument {
  symbol: string;
  name: string;
  transform?: (price: number) => number;
  snapshotKey: SnapshotInstrumentKey;
}

const MACRO_INSTRUMENTS: MacroInstrument[] = [
  { symbol: "^TNX",     name: "10Y Treasury",     snapshotKey: "treasury10Y" },
  { symbol: "^TWO",     name: "2Y Treasury",      snapshotKey: "treasury2Y" },
  { symbol: "^IRX",     name: "13W T-Bill",       snapshotKey: "treasury3M" },
  { symbol: "^VIX",     name: "VIX",              snapshotKey: "vix" },
  { symbol: "DX-Y.NYB", name: "US Dollar (DXY)",  snapshotKey: "dxy" },
  { symbol: "CL=F",     name: "WTI Crude",        snapshotKey: "oil" },
];

/**
 * Additional symbols fetched for breadth divergence only.
 * Not stored as top-level snapshot fields — used to compute
 * equal-weight vs cap-weight divergence (RSP − SPY).
 */
const BREADTH_SYMBOLS = [
  { symbol: "SPY", name: "S&P 500 ETF" },
  { symbol: "RSP", name: "S&P 500 Equal Weight" },
];

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      timeout: 10_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          reject(new Error("Bad JSON"));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// ─── Fetch a single instrument from Yahoo ────────────────────────────────────

async function fetchInstrument(inst: MacroInstrument): Promise<MacroDataPoint | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.symbol)}?interval=1d&range=5d`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await httpsGet(url)) as any;
    const meta = json?.chart?.result?.[0]?.meta ?? {};
    const price: number = meta.regularMarketPrice ?? 0;
    const prevClose: number = meta.chartPreviousClose ?? price;
    if (price === 0) return null;

    const value = inst.transform ? inst.transform(price) : price;
    const prevValue = inst.transform ? inst.transform(prevClose) : prevClose;
    const change = Math.round((value - prevValue) * 100) / 100;
    const changePercent = prevValue > 0
      ? Math.round((change / prevValue) * 10000) / 100
      : 0;

    return {
      symbol: inst.symbol,
      name: inst.name,
      value: Math.round(value * 100) / 100,
      change,
      changePercent,
    };
  } catch (err) {
    console.warn(`[macro-data] Failed to fetch ${inst.symbol}:`, (err as Error).message);
    return null;
  }
}

/** Fetch daily change percent for an ETF symbol (for breadth divergence). */
async function fetchDailyChangePct(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await httpsGet(url)) as any;
    const meta = json?.chart?.result?.[0]?.meta ?? {};
    const price: number = meta.regularMarketPrice ?? 0;
    const prevClose: number = meta.chartPreviousClose ?? price;
    if (price === 0 || prevClose === 0) return null;
    return Math.round(((price - prevClose) / prevClose) * 10000) / 100;
  } catch {
    return null;
  }
}

// ─── Compute yield curve shape ───────────────────────────────────────────────

function computeCurveShape(
  t2y: MacroDataPoint | null,
  t10y: MacroDataPoint | null,
): { spread: number | null; shape: MacroSnapshot["curveShape"] } {
  if (!t2y || !t10y) return { spread: null, shape: null };
  const spread = Math.round((t10y.value - t2y.value) * 100) / 100;

  let shape: MacroSnapshot["curveShape"];
  if (spread > 1.0) shape = "Steep";
  else if (spread > 0.25) shape = "Normal";
  else if (spread > -0.25) shape = "Flat";
  else shape = "Inverted";

  return { spread, shape };
}

// ─── Derive policy-path context ──────────────────────────────────────────────

/**
 * Derives a policy-bias signal from the rates structure.
 *
 * Logic:
 *   - If 2Y yield is materially below 3M T-bill → market is pricing rate cuts → Dovish
 *   - If 2Y yield is materially above 3M T-bill → market is pricing hikes → Hawkish
 *   - Otherwise → Neutral
 *
 * This is a reasonable proxy for FedWatch-style expectations. When real
 * FedWatch data is integrated, `source` changes from "rates-derived" to
 * "fedwatch" and `fedFundsImplied` / `cutsHikesExpected` get populated.
 */
function derivePolicyPath(
  t3m: MacroDataPoint | null,
  t2y: MacroDataPoint | null,
  t10y: MacroDataPoint | null,
): PolicyContext {
  if (!t3m && !t2y) {
    return {
      shortRate: null,
      bias: "Neutral",
      basisDescription: "Insufficient rates data to derive policy bias",
      fedFundsImplied: null,
      cutsHikesExpected: null,
      source: "unavailable",
    };
  }

  // Use 3M T-bill as proxy for current policy rate
  const shortRate = t3m;
  let bias: PolicyContext["bias"] = "Neutral";
  let basisDescription: string;

  if (t3m && t2y) {
    const diff = t2y.value - t3m.value; // negative = market expects cuts
    if (diff < -0.30) {
      bias = "Dovish";
      basisDescription = `2Y yield (${t2y.value.toFixed(2)}%) trades ${Math.abs(diff).toFixed(2)} below 3M T-bill (${t3m.value.toFixed(2)}%), implying market expects rate cuts`;
    } else if (diff > 0.30) {
      bias = "Hawkish";
      basisDescription = `2Y yield (${t2y.value.toFixed(2)}%) trades ${diff.toFixed(2)} above 3M T-bill (${t3m.value.toFixed(2)}%), implying market expects further tightening`;
    } else {
      bias = "Neutral";
      basisDescription = `2Y yield (${t2y.value.toFixed(2)}%) roughly in line with 3M T-bill (${t3m.value.toFixed(2)}%), suggesting steady policy expectations`;
    }
  } else if (t2y && t10y) {
    // Fallback: infer from 2Y direction alone
    if (t2y.change < -0.05) {
      bias = "Dovish";
      basisDescription = `2Y yield falling (${t2y.change > 0 ? "+" : ""}${t2y.change.toFixed(2)}), suggesting easing expectations`;
    } else if (t2y.change > 0.05) {
      bias = "Hawkish";
      basisDescription = `2Y yield rising (${t2y.change > 0 ? "+" : ""}${t2y.change.toFixed(2)}), suggesting tightening expectations`;
    } else {
      bias = "Neutral";
      basisDescription = `2Y yield stable, no strong directional policy signal`;
    }
  } else {
    basisDescription = `Only partial rates data available — limited policy inference`;
  }

  return {
    shortRate,
    bias,
    basisDescription,
    fedFundsImplied: null,    // Future: CME FedWatch
    cutsHikesExpected: null,  // Future: "2.5 cuts priced in by Dec"
    source: (t3m && t2y) ? "rates-derived" : "rates-derived",
  };
}

// ─── Compute breadth ─────────────────────────────────────────────────────────

/**
 * Builds a BreadthReading from two layers:
 *   1. Watchlist advance/decline (always available if watchlist populated)
 *   2. SPY vs RSP divergence (ETF-based breadth proxy)
 *
 * The source field is always honest about what it represents.
 */
function computeBreadth(
  watchlistData: { advancers: number; decliners: number; total: number } | null,
  spyPct: number | null,
  rspPct: number | null,
): BreadthReading {
  const hasEtfDivergence = spyPct !== null && rspPct !== null;
  const hasWatchlist = watchlistData !== null && watchlistData.total > 0;

  // Watchlist A/D
  const watchlist = hasWatchlist
    ? {
        advancers: watchlistData!.advancers,
        decliners: watchlistData!.decliners,
        ratio: watchlistData!.decliners > 0
          ? Math.round((watchlistData!.advancers / watchlistData!.decliners) * 100) / 100
          : watchlistData!.advancers > 0 ? 99 : 1,
        sampleSize: watchlistData!.total,
      }
    : null;

  // ETF divergence: RSP% − SPY% (positive = breadth expanding)
  const equalWeightDivergence = hasEtfDivergence
    ? Math.round((rspPct! - spyPct!) * 100) / 100
    : null;

  // Determine assessment — ETF divergence takes precedence when available
  let assessment: BreadthReading["assessment"] = null;
  let description = "Breadth data unavailable";
  let source: BreadthReading["source"] = "watchlist-proxy";

  if (hasEtfDivergence) {
    source = "etf-divergence";
    const div = equalWeightDivergence!;
    if (div > 0.3) {
      assessment = "Broad";
      description = `Equal-weight S&P outperforming cap-weight by ${div.toFixed(2)}pp — small/mid-caps leading, breadth expanding`;
    } else if (div > -0.15) {
      assessment = "Healthy";
      description = `SPY/RSP divergence minimal (${div > 0 ? "+" : ""}${div.toFixed(2)}pp) — reasonably broad participation`;
    } else if (div > -0.50) {
      assessment = "Narrow";
      description = `Cap-weight outperforming equal-weight by ${Math.abs(div).toFixed(2)}pp — mega-caps leading, breadth thinning`;
    } else {
      assessment = "Very Narrow";
      description = `Cap-weight outperforming equal-weight by ${Math.abs(div).toFixed(2)}pp — rally driven by narrow leadership`;
    }
  } else if (hasWatchlist) {
    const ratio = watchlist!.ratio;
    if (ratio > 2.0) assessment = "Broad";
    else if (ratio > 1.0) assessment = "Healthy";
    else if (ratio > 0.5) assessment = "Narrow";
    else assessment = "Very Narrow";
    description = `Watchlist proxy (${watchlist!.sampleSize} names): ${watchlist!.advancers}A/${watchlist!.decliners}D — ${assessment.toLowerCase()} participation`;
  }

  return { source, watchlist, equalWeightDivergence, assessment, description };
}

// ─── Compute confidence meta ─────────────────────────────────────────────────

/** Core macro categories and their importance weights for confidence scoring */
const INPUT_WEIGHTS: Array<{ key: string; weight: number }> = [
  { key: "Indices",    weight: 15 },
  { key: "10Y",        weight: 12 },
  { key: "2Y",         weight: 10 },
  { key: "3M",         weight: 8 },
  { key: "Curve",      weight: 10 },
  { key: "Policy",     weight: 8 },
  { key: "VIX",        weight: 12 },
  { key: "DXY",        weight: 8 },
  { key: "Oil",        weight: 5 },
  { key: "Breadth",    weight: 7 },
  { key: "Sentiment",  weight: 5 },
  // Total weight = 100
];

function computeConfidence(
  available: Map<string, boolean>,
  breadthSource: BreadthReading["source"],
  policySource: PolicyContext["source"],
  snapshotAge: number,
  isStale: boolean,
): ConfidenceMeta {
  let rawScore = 0;
  let maxScore = 0;
  const reasons: string[] = [];

  for (const { key, weight } of INPUT_WEIGHTS) {
    maxScore += weight;
    if (available.get(key)) {
      rawScore += weight;
    }
  }

  // Deductions for proxy-quality signals
  if (breadthSource === "watchlist-proxy") {
    rawScore = Math.max(0, rawScore - 3);
    reasons.push("Breadth is a watchlist proxy, not market-wide");
  }
  if (policySource === "unavailable") {
    reasons.push("Policy path unavailable — no short-rate data");
  } else if (policySource === "rates-derived") {
    rawScore = Math.max(0, rawScore - 2);
    reasons.push("Policy bias derived from rates structure (no FedWatch)");
  }

  // Staleness deduction
  if (isStale) {
    rawScore = Math.max(0, rawScore - 15);
    reasons.push("Snapshot data is stale");
  } else if (snapshotAge > 60) {
    rawScore = Math.max(0, rawScore - 5);
    reasons.push(`Snapshot is ${Math.round(snapshotAge)}min old`);
  }

  const score = Math.round((rawScore / maxScore) * 100);
  const inputCoverage = rawScore / maxScore;

  let level: ConfidenceMeta["level"];
  if (score >= 70) level = "High";
  else if (score >= 40) level = "Medium";
  else level = "Low";

  // Add positive reasons
  if (score >= 70) reasons.unshift("Most macro inputs available and recent");
  else if (score >= 40) reasons.unshift("Partial input coverage — interpret with caution");
  else reasons.unshift("Limited input coverage — low-confidence assessment");

  return {
    level,
    score,
    reasons,
    inputCoverage: Math.round(inputCoverage * 100) / 100,
    isStale,
    snapshotAgeMinutes: Math.round(snapshotAge),
  };
}

// ─── Build input signals for UI ──────────────────────────────────────────────

function buildSignals(
  instruments: Partial<Record<SnapshotInstrumentKey, MacroDataPoint | null>>,
  hasIndices: boolean,
  curveAvailable: boolean,
  policy: PolicyContext,
  breadth: BreadthReading,
  hasFearGreed: boolean,
  hasNews: boolean,
): InputSignal[] {
  const signals: InputSignal[] = [];

  signals.push({
    category: "Indices",
    status: hasIndices ? "live" : "missing",
    label: hasIndices ? "S&P / Dow / Nasdaq / Russell" : "No index data",
  });
  signals.push({
    category: "Rates",
    status: (instruments.treasury10Y || instruments.treasury2Y) ? "live" : "missing",
    label: [
      instruments.treasury10Y ? "10Y" : null,
      instruments.treasury2Y ? "2Y" : null,
      instruments.treasury3M ? "3M" : null,
    ].filter(Boolean).join(", ") || "No rates data",
  });
  signals.push({
    category: "Curve",
    status: curveAvailable ? "derived" : "missing",
    label: curveAvailable ? "2s10s spread" : "Needs 2Y + 10Y",
  });
  signals.push({
    category: "Policy",
    status: policy.source === "unavailable" ? "missing" : "derived",
    label: policy.source === "rates-derived" ? `${policy.bias} (rates-derived)` : policy.source === "fedwatch" ? `${policy.bias} (FedWatch)` : "No policy signal",
  });
  signals.push({
    category: "Volatility",
    status: instruments.vix ? "live" : "missing",
    label: instruments.vix ? `VIX ${instruments.vix.value.toFixed(1)}` : "No VIX data",
  });
  signals.push({
    category: "Dollar",
    status: instruments.dxy ? "live" : "missing",
    label: instruments.dxy ? `DXY ${instruments.dxy.value.toFixed(1)}` : "No DXY data",
  });
  signals.push({
    category: "Oil",
    status: instruments.oil ? "live" : "missing",
    label: instruments.oil ? `WTI $${instruments.oil.value.toFixed(1)}` : "No oil data",
  });
  signals.push({
    category: "Breadth",
    status: breadth.assessment ? (breadth.source === "etf-divergence" ? "live" : "proxy") : "missing",
    label: breadth.assessment
      ? `${breadth.assessment} (${breadth.source === "etf-divergence" ? "SPY/RSP" : "watchlist"})`
      : "No breadth data",
  });
  signals.push({
    category: "Sentiment",
    status: hasFearGreed ? "live" : "missing",
    label: hasFearGreed ? "CNN Fear & Greed" : "No sentiment data",
  });
  signals.push({
    category: "News",
    status: hasNews ? "live" : "missing",
    label: hasNews ? "Market headlines" : "No recent news",
  });

  return signals;
}

// ─── Gather news headlines ───────────────────────────────────────────────────

function gatherHeadlines(): string[] {
  const symbols = getWatchlistSymbols();
  const headlines: string[] = [];
  for (const sym of symbols.slice(0, 5)) {
    const newsResult = loadNews(sym);
    if (newsResult?.data) {
      for (const item of newsResult.data.slice(0, 3)) {
        headlines.push(item.title);
      }
    }
  }
  return headlines;
}

// ─── Build full macro snapshot ───────────────────────────────────────────────

/**
 * Builds a complete MacroSnapshot by fetching all macro instruments
 * and gathering contextual data from the store.
 *
 * Returns a cached snapshot if fresh enough, otherwise fetches live.
 * Every fetch is independent — partial data is expected and handled.
 */
export async function buildMacroSnapshot(): Promise<MacroSnapshot> {
  // 1. Check in-memory cache
  const cacheKey = "macro:snapshot";
  const cached = cache.get<MacroSnapshot>(cacheKey);
  if (cached) return cached;

  // 2. Check store — return if fresh
  const stored = loadMacroSnapshot();
  if (stored && !stored.stale) {
    cache.set(cacheKey, stored.data, TTL.MACRO_SNAPSHOT);
    return stored.data;
  }

  // 3. Fetch all instruments + breadth ETFs in parallel
  const [instrumentResults, spyPct, rspPct] = await Promise.all([
    Promise.allSettled(MACRO_INSTRUMENTS.map((inst) => fetchInstrument(inst))),
    fetchDailyChangePct("SPY"),
    fetchDailyChangePct("RSP"),
  ]);

  // Map results back to instrument keys
  const instruments: Partial<Record<SnapshotInstrumentKey, MacroDataPoint | null>> = {};
  MACRO_INSTRUMENTS.forEach((inst, i) => {
    const result = instrumentResults[i];
    instruments[inst.snapshotKey] = result.status === "fulfilled" ? result.value : null;
  });

  // 4. Gather store-based inputs
  const indicesResult = loadIndices();
  const indices = indicesResult?.data ?? [];

  const fearGreedRaw = cache.get<FearGreedData>("fear-greed");
  const fearGreed = fearGreedRaw
    ? { score: fearGreedRaw.score, label: fearGreedRaw.label }
    : null;

  const wl = loadWatchlist();
  const wlData = wl?.data ?? [];
  const topMovers = wlData
    .map((w) => ({ symbol: w.symbol, changePercent: w.changePercent }))
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 8);

  const headlines = gatherHeadlines();

  // 5. Compute derived signals
  const t2y = instruments.treasury2Y ?? null;
  const t10y = instruments.treasury10Y ?? null;
  const t3m = instruments.treasury3M ?? null;
  const { spread, shape } = computeCurveShape(t2y, t10y);

  const policyPath = derivePolicyPath(t3m, t2y, t10y);

  // Watchlist A/D for breadth
  let wlBreadthData: { advancers: number; decliners: number; total: number } | null = null;
  if (wlData.length > 0) {
    let adv = 0, dec = 0;
    for (const e of wlData) {
      if (e.changePercent > 0) adv++;
      else if (e.changePercent < 0) dec++;
    }
    wlBreadthData = { advancers: adv, decliners: dec, total: wlData.length };
  }
  const breadth = computeBreadth(wlBreadthData, spyPct, rspPct);

  // 6. Track available/missing inputs
  const availableInputs: string[] = [];
  const missingInputs: string[] = [];
  const availableMap = new Map<string, boolean>();

  const check = (key: string, label: string, present: boolean) => {
    availableMap.set(key, present);
    if (present) availableInputs.push(label);
    else missingInputs.push(label);
  };

  check("Indices",   "Equity indices",       indices.length > 0);
  check("10Y",       "10Y Treasury",         !!instruments.treasury10Y);
  check("2Y",        "2Y Treasury",          !!instruments.treasury2Y);
  check("3M",        "13W T-Bill",           !!instruments.treasury3M);
  check("Curve",     "Yield curve (2s10s)",   spread !== null);
  check("Policy",    "Policy path",          policyPath.source !== "unavailable");
  check("VIX",       "VIX",                  !!instruments.vix);
  check("DXY",       "US Dollar (DXY)",      !!instruments.dxy);
  check("Oil",       "WTI Crude",            !!instruments.oil);
  check("Breadth",   "Market breadth",       breadth.assessment !== null);
  check("Sentiment", "Fear & Greed",         !!fearGreed);

  if (headlines.length > 0) availableInputs.push("News headlines");
  else missingInputs.push("News headlines");

  // Future placeholders
  missingInputs.push("CME FedWatch (future)");
  missingInputs.push("FRED macro series (future)");

  // 7. Build input signals for UI
  const signals = buildSignals(
    instruments, indices.length > 0, spread !== null,
    policyPath, breadth, !!fearGreed, headlines.length > 0,
  );

  // 8. Compute confidence
  const snapshotAge = stored ? (Date.now() - new Date(stored.updatedAt).getTime()) / 60_000 : 0;
  const confidence = computeConfidence(
    availableMap, breadth.source, policyPath.source,
    snapshotAge, false,
  );

  const snapshot: MacroSnapshot = {
    // 1. Objective market state
    indices,
    treasury2Y: t2y,
    treasury10Y: t10y,
    treasury3M: t3m,
    vix: instruments.vix ?? null,
    dxy: instruments.dxy ?? null,
    oil: instruments.oil ?? null,
    fearGreed,
    // 2. Derived regime signals
    yieldCurve2s10s: spread,
    curveShape: shape,
    policyPath,
    breadth,
    // 3. Narrative inputs
    topMovers,
    headlines,
    // 4. Metadata
    timestamp: new Date().toISOString(),
    confidence,
    signals,
    availableInputs,
    missingInputs,
  };

  // 9. Persist and cache
  saveMacroSnapshot(snapshot);
  cache.set(cacheKey, snapshot, TTL.MACRO_SNAPSHOT);

  return snapshot;
}
