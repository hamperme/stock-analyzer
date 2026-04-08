/**
 * Google Gemini AI integration.
 *
 * Uses @google/genai SDK with gemini-2.5-flash model.
 * Falls back to rule-based analysis when no API key is set.
 */

import { GoogleGenAI } from "@google/genai";
import type { AIAnalysis, TechnicalIndicators, MacroView, MacroSnapshot, MarketIndex, FearGreedData, SetupAnalysis, SetupAnalysisInput } from "./types";

const MODEL_NAME = "gemini-2.5-flash";

function getClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

/** Exported so routes/debug can inspect configuration. */
export function getGeminiStatus() {
  return {
    hasKey: !!process.env.GEMINI_API_KEY,
    model: MODEL_NAME,
  };
}

// ─── Stock Analysis ───────────────────────────────────────────────────────────

export interface GenerateResult {
  analysis: AIAnalysis;
  /** "gemini" if Gemini was called, "fallback" if rule-based */
  source: "gemini" | "fallback";
  /** Non-null when source === "fallback" due to an error */
  geminiError: string | null;
}

export async function generateStockAnalysis(params: {
  symbol: string;
  shortName: string;
  price: number;
  changePercent: number;
  indicators: TechnicalIndicators;
  newsHeadlines: string[];
}): Promise<GenerateResult> {
  const client = getClient();

  if (!client) {
    return {
      analysis: fallbackAnalysis(params),
      source: "fallback",
      geminiError: "GEMINI_API_KEY not set",
    };
  }

  const { symbol, shortName, price, changePercent, indicators, newsHeadlines } = params;

  const prompt = `You are an expert quantitative stock analyst. Analyze this stock and return a JSON object.

STOCK: ${symbol} (${shortName})
PRICE: $${price.toFixed(2)} (${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}% today)

TECHNICAL INDICATORS:
- MA20: $${indicators.ma20} | MA50: $${indicators.ma50} | MA200: $${indicators.ma200}
- Price vs MA50: ${indicators.priceVsMa50Pct > 0 ? "+" : ""}${indicators.priceVsMa50Pct}%
- Price vs MA200: ${indicators.priceVsMa200Pct > 0 ? "+" : ""}${indicators.priceVsMa200Pct}%
- RSI(14): ${indicators.rsi}
- Relative Volume: ${indicators.relativeVolume}x
- Trend Regime: ${indicators.trendRegime}
- 52w Range: $${indicators.low52w} - $${indicators.high52w}
- Distance from 52w High: ${indicators.distFrom52wHighPct}%
- Setup Score: ${indicators.setupScore}/100 (${indicators.setupLabel})

RECENT NEWS (${newsHeadlines.length} items):
${newsHeadlines.slice(0, 8).map((h, i) => `${i + 1}. ${h}`).join("\n")}

Respond ONLY with a valid JSON object matching this exact schema (no markdown, no explanation):
{
  "bullCase": ["string", "string", "string"],
  "bearCase": ["string", "string", "string"],
  "risks": ["string", "string"],
  "recommendation": "Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell",
  "confidence": "High" | "Medium" | "Low",
  "summary": "2-3 sentence technical interpretation",
  "targetEntry": "$XXX-XXX (optional)",
  "stopLoss": "$XXX (optional)"
}`;

  try {
    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });

    const text = (response.text ?? "").trim();

    if (!text) {
      throw new Error("Gemini returned empty response");
    }

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
    const parsed = JSON.parse(cleaned) as AIAnalysis;

    return {
      analysis: {
        ...parsed,
        generatedAt: new Date().toISOString(),
      },
      source: "gemini",
      geminiError: null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[gemini] Analysis generation failed:", errMsg);
    return {
      analysis: fallbackAnalysis(params),
      source: "fallback",
      geminiError: errMsg,
    };
  }
}

// ─── News Summarization ───────────────────────────────────────────────────────

export async function summarizeNewsItem(
  title: string,
  symbol: string
): Promise<string> {
  const client = getClient();
  if (!client) return "";

  try {
    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents: `In 1-2 sentences, summarize what this headline means for $${symbol} investors: "${title}". Be direct and analytical.`,
    });
    return (response.text ?? "").trim();
  } catch {
    return "";
  }
}

// ─── Macro Market View ───────────────────────────────────────────────────────

/**
 * Build a structured context block from a MacroSnapshot.
 * Only includes sections for data that is actually available.
 * Clearly separates objective state from derived interpretation.
 */
function buildSnapshotContext(snap: MacroSnapshot): { context: string; dataSources: string[] } {
  const dataSources: string[] = [];
  const s = (n: number, d = 2) => n.toFixed(d);
  const sign = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;
  let context = "";

  // ═══ SECTION 1: Objective Market State ═══

  context += "══ OBJECTIVE MARKET STATE ══\n\n";

  // Indices
  if (snap.indices.length > 0) {
    dataSources.push("Equity indices");
    context += "EQUITY INDICES:\n";
    for (const idx of snap.indices) {
      context += `  ${idx.name}: ${idx.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} (${sign(idx.changePercent)}%)\n`;
    }
    context += "\n";
  }

  // Rates (all available tenors)
  const hasAnyRate = snap.treasury3M || snap.treasury2Y || snap.treasury10Y;
  if (hasAnyRate) {
    context += "TREASURY YIELDS:\n";
    if (snap.treasury3M) {
      dataSources.push("13W T-Bill");
      context += `  3M T-Bill:  ${s(snap.treasury3M.value)}% (${sign(snap.treasury3M.change)})\n`;
    }
    if (snap.treasury2Y) {
      dataSources.push("2Y Treasury");
      context += `  2Y Yield:   ${s(snap.treasury2Y.value)}% (${sign(snap.treasury2Y.change)})\n`;
    }
    if (snap.treasury10Y) {
      dataSources.push("10Y Treasury");
      context += `  10Y Yield:  ${s(snap.treasury10Y.value)}% (${sign(snap.treasury10Y.change)})\n`;
    }
    if (snap.yieldCurve2s10s !== null && snap.curveShape) {
      dataSources.push("Yield curve");
      context += `  2s10s Spread: ${sign(snap.yieldCurve2s10s)} → ${snap.curveShape}\n`;
    }
    context += "\n";
  }

  // VIX
  if (snap.vix) {
    dataSources.push("VIX");
    const vr = snap.vix.value < 15 ? "low-vol" : snap.vix.value < 20 ? "normal" : snap.vix.value < 30 ? "elevated" : "high-vol";
    context += `VIX: ${s(snap.vix.value)} (${sign(snap.vix.change)}, ${vr} regime)\n\n`;
  }

  // Dollar
  if (snap.dxy) {
    dataSources.push("US Dollar (DXY)");
    context += `US DOLLAR INDEX (DXY): ${s(snap.dxy.value)} (${sign(snap.dxy.changePercent)}%)\n\n`;
  }

  // Oil
  if (snap.oil) {
    dataSources.push("WTI Crude");
    context += `WTI CRUDE OIL: $${s(snap.oil.value)} (${sign(snap.oil.changePercent)}%)\n\n`;
  }

  // Sentiment
  if (snap.fearGreed) {
    dataSources.push("Fear & Greed");
    context += `CNN FEAR & GREED INDEX: ${snap.fearGreed.score}/100 (${snap.fearGreed.label})\n\n`;
  }

  // ═══ SECTION 2: Derived Regime Signals ═══

  context += "══ DERIVED SIGNALS (interpret with context) ══\n\n";

  // Policy path
  if (snap.policyPath.source !== "unavailable") {
    dataSources.push("Policy path (rates-derived)");
    context += `POLICY BIAS: ${snap.policyPath.bias}\n`;
    context += `  Basis: ${snap.policyPath.basisDescription}\n`;
    context += `  Source: ${snap.policyPath.source} (no direct FedWatch data)\n\n`;
  }

  // Breadth
  if (snap.breadth.assessment) {
    dataSources.push(`Breadth (${snap.breadth.source})`);
    context += `BREADTH: ${snap.breadth.assessment}\n`;
    context += `  ${snap.breadth.description}\n`;
    if (snap.breadth.equalWeightDivergence !== null) {
      context += `  SPY/RSP divergence: ${sign(snap.breadth.equalWeightDivergence)}pp\n`;
    }
    if (snap.breadth.watchlist) {
      context += `  Watchlist A/D: ${snap.breadth.watchlist.advancers}/${snap.breadth.watchlist.decliners} (${snap.breadth.watchlist.sampleSize} names — watchlist proxy only)\n`;
    }
    context += "\n";
  }

  // ═══ SECTION 3: Narrative Context ═══

  context += "══ NARRATIVE CONTEXT ══\n\n";

  if (snap.topMovers.length > 0) {
    dataSources.push("Watchlist movers");
    context += "TOP MOVERS:\n";
    for (const m of snap.topMovers.slice(0, 8)) {
      context += `  ${m.symbol}: ${sign(m.changePercent)}%\n`;
    }
    context += "\n";
  }

  if (snap.headlines.length > 0) {
    dataSources.push("News headlines");
    context += `RECENT HEADLINES (${snap.headlines.length}):\n`;
    for (const h of snap.headlines.slice(0, 12)) {
      context += `  - ${h}\n`;
    }
    context += "\n";
  }

  return { context, dataSources };
}

export async function generateMacroView(snapshot: MacroSnapshot): Promise<MacroView> {
  const client = getClient();
  const { context, dataSources } = buildSnapshotContext(snapshot);

  if (!client) {
    return fallbackMacroView(snapshot, dataSources);
  }

  const conf = snapshot.confidence;

  const prompt = `You are an AI macro-regime analyst producing a structured bull-vs-bear assessment from market data. This is an AI-synthesized view — not proprietary research.

=== MACRO SNAPSHOT (${snapshot.timestamp}) ===
${context}
=== INPUT COVERAGE: ${conf.score}/100 (${conf.level} confidence) ===
=== AVAILABLE: ${snapshot.availableInputs.join(", ")} ===
=== MISSING: ${snapshot.missingInputs.join(", ")} ===

ANALYSIS FRAMEWORK — reason from these structured signals:

RATES & POLICY:
- Falling yields → dovish tilt, easing financial conditions, supports risk assets
- Rising yields → tightening, pressures valuations (especially growth/duration)
- 2Y below 3M T-bill → market pricing rate cuts ahead
- 2Y above 3M T-bill → market pricing steady/higher rates
- Steepening curve → economic optimism or re-steepening from cuts
- Flat/inverted curve → growth concern, recession risk historically

VOLATILITY:
- VIX < 15: complacency, low-vol carry regime
- VIX 15–20: normal; VIX 20–30: caution; VIX > 30: fear/capitulation

CROSS-ASSET:
- Strong dollar → headwind for multinationals, EM, commodities
- Weak dollar → tailwind for international earnings, commodities
- Oil rising → inflation pressure, energy strength, consumer headwind
- Oil falling → disinflationary, consumer relief, demand concern

BREADTH:
- Equal-weight outperforming cap-weight → breadth expanding, healthy
- Cap-weight outperforming equal-weight → narrow mega-cap leadership, fragile
- NOTE: watchlist A/D is a proxy only, not market-wide breadth

SENTIMENT:
- F&G < 25 → extreme fear, contrarian bullish setup
- F&G > 75 → extreme greed, complacency risk

Respond ONLY with a valid JSON object (no markdown fences, no explanation):
{
  "bullPoints": ["3-5 concise bullish observations — cite specific data points"],
  "bearPoints": ["3-5 concise bearish risks — cite specific data points"],
  "neutralSummary": "2-3 sentence balanced regime assessment. Start with objective state, then interpretation.",
  "watchItems": ["2-3 specific forward-looking items: what data, level, or catalyst changes the regime next?"],
  "regime": "Risk-On" | "Cautious" | "Risk-Off" | "Mixed"
}

RULES:
- Every bullet MUST cite a specific number from the snapshot
- Keep each bullet to 1 sentence, trader-friendly
- Do NOT invent data — only reference what appears above
- When referencing breadth, state whether it is from SPY/RSP divergence or watchlist proxy
- neutralSummary: lead with objective market state (yields, VIX, indices), then add interpretation
- If policy path is "rates-derived", say "implied by rates structure" — do not claim direct FedWatch data
- watchItems must be concrete: specific levels, dates, or data releases — not "watch the market"
- Adjust tone to match confidence level (${conf.level}): if Low, add caveats about limited data`;

  try {
    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });

    const text = (response.text ?? "").trim();
    if (!text) throw new Error("Gemini returned empty response");

    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
    const parsed = JSON.parse(cleaned);

    return {
      bullPoints: parsed.bullPoints ?? [],
      bearPoints: parsed.bearPoints ?? [],
      neutralSummary: parsed.neutralSummary ?? "",
      watchItems: parsed.watchItems ?? [],
      regime: parsed.regime ?? "Mixed",
      confidence: snapshot.confidence,
      generatedAt: new Date().toISOString(),
      source: "gemini",
      dataSources,
      snapshot,
    };
  } catch (err) {
    console.error("[gemini] Macro view generation failed:", (err as Error).message);
    return fallbackMacroView(snapshot, dataSources);
  }
}

function fallbackMacroView(snap: MacroSnapshot, dataSources: string[]): MacroView {
  const avgChange = snap.indices.length > 0
    ? snap.indices.reduce((s, i) => s + i.changePercent, 0) / snap.indices.length
    : 0;
  const bullish = avgChange > 0;
  const fg = snap.fearGreed;
  const pp = snap.policyPath;
  const br = snap.breadth;

  const bullPoints: string[] = [];
  const bearPoints: string[] = [];
  const watchItems: string[] = [];

  // ── Index-based ──
  if (bullish) {
    bullPoints.push(`Major indices trading higher (avg ${avgChange > 0 ? "+" : ""}${avgChange.toFixed(2)}%)`);
  } else {
    bearPoints.push(`Indices under pressure (avg ${avgChange.toFixed(2)}%)`);
    bullPoints.push("Pullbacks can create entry opportunities at lower valuations");
  }
  if (bullish) {
    bearPoints.push("Extended rallies raise near-term pullback risk");
  }

  // ── VIX ──
  if (snap.vix) {
    if (snap.vix.value < 18) {
      bullPoints.push(`Low VIX at ${snap.vix.value.toFixed(1)} supports risk-on positioning`);
    } else if (snap.vix.value > 25) {
      bearPoints.push(`Elevated VIX at ${snap.vix.value.toFixed(1)} signals market stress`);
    } else {
      // Normal range — still useful context
      watchItems.push(`VIX at ${snap.vix.value.toFixed(1)} — watch for break above 25`);
    }
  }

  // ── Policy path ──
  if (pp.source !== "unavailable") {
    if (pp.bias === "Dovish") {
      bullPoints.push(`Rates structure implies dovish bias — ${pp.basisDescription.split(",")[0]}`);
    } else if (pp.bias === "Hawkish") {
      bearPoints.push(`Rates structure implies hawkish bias — ${pp.basisDescription.split(",")[0]}`);
    }
  }

  // ── Yield curve ──
  if (snap.curveShape === "Inverted") {
    bearPoints.push(`Yield curve inverted (2s10s: ${snap.yieldCurve2s10s?.toFixed(2)}) — historical recession indicator`);
  } else if (snap.curveShape === "Steep") {
    bullPoints.push(`Steep yield curve (2s10s: ${snap.yieldCurve2s10s?.toFixed(2)}) signals growth optimism`);
  }

  // ── Dollar ──
  if (snap.dxy) {
    if (snap.dxy.changePercent > 0.3) {
      bearPoints.push(`Strengthening dollar (DXY ${snap.dxy.changePercent > 0 ? "+" : ""}${snap.dxy.changePercent.toFixed(2)}%) headwind for multinationals`);
    } else if (snap.dxy.changePercent < -0.3) {
      bullPoints.push(`Weakening dollar (DXY ${snap.dxy.changePercent.toFixed(2)}%) tailwind for international revenue`);
    }
  }

  // ── Oil ──
  if (snap.oil) {
    if (snap.oil.changePercent > 2) {
      bearPoints.push(`Oil surging (WTI ${snap.oil.changePercent > 0 ? "+" : ""}${snap.oil.changePercent.toFixed(2)}%) raises inflation concerns`);
    } else if (snap.oil.changePercent < -2) {
      bullPoints.push(`Falling oil (WTI ${snap.oil.changePercent.toFixed(2)}%) eases consumer/input cost pressure`);
    }
  }

  // ── Sentiment ──
  if (fg) {
    if (fg.score < 25) {
      bullPoints.push(`Extreme fear (F&G ${fg.score}) — contrarian bullish signal`);
    } else if (fg.score > 75) {
      bearPoints.push(`Extreme greed (F&G ${fg.score}) — complacency risk`);
    }
  }

  // ── Breadth (explicit about source) ──
  if (br.assessment) {
    const srcLabel = br.source === "etf-divergence" ? "SPY/RSP" : "watchlist proxy";
    if (br.assessment === "Broad" || br.assessment === "Healthy") {
      bullPoints.push(`Breadth ${br.assessment.toLowerCase()} (${srcLabel}) — ${br.description.split("—")[1]?.trim() ?? "participation widening"}`);
    } else {
      bearPoints.push(`Breadth ${br.assessment.toLowerCase()} (${srcLabel}) — ${br.description.split("—")[1]?.trim() ?? "narrow leadership"}`);
    }
  }

  // ── Ensure minimums ──
  while (bullPoints.length < 3) bullPoints.push("Monitor for improving cross-asset signals");
  while (bearPoints.length < 3) bearPoints.push("Macro uncertainty remains — stay alert for deterioration");

  // ── Watch items ──
  if (snap.treasury10Y) watchItems.push(`10Y yield at ${snap.treasury10Y.value.toFixed(2)}% — key level for duration-sensitive assets`);
  if (pp.source !== "unavailable") watchItems.push(`Policy bias: ${pp.bias} — next FOMC communications are the catalyst`);
  if (watchItems.length < 2) watchItems.push("Upcoming data releases (CPI, employment) will clarify macro direction");
  while (watchItems.length < 2) watchItems.push("Earnings forward guidance for growth vs value rotation signals");

  // ── Summary ──
  const parts: string[] = [];
  if (bullish) parts.push(`positive equity momentum (avg ${avgChange > 0 ? "+" : ""}${avgChange.toFixed(2)}%)`);
  else parts.push(`negative equity momentum (avg ${avgChange.toFixed(2)}%)`);
  if (snap.vix) parts.push(`VIX at ${snap.vix.value.toFixed(1)}`);
  if (snap.curveShape) parts.push(`${snap.curveShape.toLowerCase()} yield curve`);
  if (pp.source !== "unavailable") parts.push(`${pp.bias.toLowerCase()} policy bias`);
  if (fg) parts.push(`F&G at ${fg.score}`);
  const neutralSummary = `Market showing ${parts.join(", ")}. ${br.assessment ? `Breadth is ${br.assessment.toLowerCase()} (${br.source}).` : ""} Rule-based summary — configure GEMINI_API_KEY for AI-synthesized views.`.trim();

  // ── Regime ──
  let regime: MacroView["regime"] = "Mixed";
  if (avgChange > 0.5 && (!snap.vix || snap.vix.value < 22) && pp.bias !== "Hawkish") regime = "Risk-On";
  else if (avgChange < -0.5 || (snap.vix && snap.vix.value > 28)) regime = "Risk-Off";
  else if (avgChange < 0 || (snap.vix && snap.vix.value > 22) || pp.bias === "Hawkish") regime = "Cautious";

  return {
    bullPoints: bullPoints.slice(0, 5),
    bearPoints: bearPoints.slice(0, 5),
    neutralSummary,
    watchItems: watchItems.slice(0, 3),
    regime,
    confidence: snap.confidence,
    generatedAt: new Date().toISOString(),
    source: "fallback",
    dataSources: [...dataSources, "Rule-based fallback"],
    snapshot: snap,
  };
}

// ─── Chart Setup Analysis ────────────────────────────────────────────────────

export async function generateSetupAnalysis(input: SetupAnalysisInput): Promise<SetupAnalysis> {
  const client = getClient();
  const indicatorsUsed = input.activeIndicators.map((i) => i.name);
  const ctx = { symbol: input.symbol, range: input.range, interval: input.interval, chartType: input.chartType };

  const hasMacroContext = !!input.macroContext;

  if (!client) {
    return fallbackSetupAnalysis(input, indicatorsUsed, ctx, hasMacroContext);
  }

  // Build indicator context — include structured data when available
  let indicatorBlock = "";
  if (input.activeIndicators.length > 0) {
    indicatorBlock = "ACTIVE INDICATORS (only these are visible to the user):\n";
    for (const ind of input.activeIndicators) {
      indicatorBlock += `  ${ind.name}: ${ind.state}\n`;
      if (ind.structured) {
        const s = ind.structured;
        if (s.bollinger) indicatorBlock += `    [structured] bandwidth=${s.bollinger.bandwidth.toFixed(2)}, %B=${s.bollinger.percentB}\n`;
        if (s.stochastic) indicatorBlock += `    [structured] zone=${s.stochastic.zone}, crossover=${s.stochastic.crossover}\n`;
        if (s.macd) indicatorBlock += `    [structured] histogramSign=${s.macd.histogramSign}, crossover=${s.macd.crossover}, histogram=${s.macd.histogram.toFixed(4)}\n`;
        if (s.adx) indicatorBlock += `    [structured] trendStrength=${s.adx.trendStrength}, direction=${s.adx.direction}\n`;
        if (s.ichimoku) indicatorBlock += `    [structured] tenkanAboveKijun=${s.ichimoku.tenkanAboveKijun}, priceVsCloud=${s.ichimoku.priceVsCloud}, cloudColor=${s.ichimoku.cloudColor}\n`;
        if (s.movingAverages) indicatorBlock += `    [structured] alignment=${s.movingAverages.alignment}\n`;
        if (s.fibRetracement) indicatorBlock += `    [structured] nearestLevel=${(s.fibRetracement.nearestLevel * 100).toFixed(1)}%, distance=$${s.fibRetracement.priceDistance.toFixed(2)}\n`;
        if (s.fibExtension) indicatorBlock += `    [structured] nearestLevel=${(s.fibExtension.nearestLevel * 100).toFixed(1)}%, distance=$${s.fibExtension.priceDistance.toFixed(2)}\n`;
        if (s.stdDev) indicatorBlock += `    [structured] volatility=${s.stdDev.percentOfPrice.toFixed(2)}% of price\n`;
        if (s.pitchfork) {
          const pf = s.pitchfork;
          indicatorBlock += `    [structured] position=${pf.position}, distFromMedian=${pf.distFromMedianPct > 0 ? "+" : ""}${pf.distFromMedianPct}%\n`;
          indicatorBlock += `    [structured] medianSlope=${pf.medianSlope}, reverting=${pf.reverting}\n`;
          indicatorBlock += `    [structured] priceVsMedian=${pf.priceVsMedian}, priceVsUpperTine=${pf.priceVsUpperTine}, priceVsLowerTine=${pf.priceVsLowerTine}\n`;
          indicatorBlock += `    [structured] priceVsUpperWarning=${pf.priceVsUpperWarning}, priceVsLowerWarning=${pf.priceVsLowerWarning}\n`;
        }
      }
    }
  } else {
    indicatorBlock = "NO ADVANCED INDICATORS ACTIVE — only price action and moving averages are visible.\n";
  }

  // Build structured macro block
  let macroBlock = "";
  if (input.macroContext) {
    const mc = input.macroContext;
    macroBlock = "MACRO CONTEXT:\n";
    macroBlock += `  Regime: ${mc.regime} (confidence: ${mc.confidence}, score: ${mc.confidenceScore}/100${mc.isStale ? ", STALE" : ""})\n`;
    if (mc.policyBias) macroBlock += `  Policy bias: ${mc.policyBias}\n`;
    if (mc.volatility) macroBlock += `  Volatility: VIX ${mc.volatility.vix.toFixed(1)} (${mc.volatility.regime})\n`;
    if (mc.breadth) macroBlock += `  Breadth: ${mc.breadth}\n`;
    if (mc.fearGreed) macroBlock += `  Fear & Greed: ${mc.fearGreed.score} (${mc.fearGreed.label})\n`;
    if (mc.bullDrivers.length) macroBlock += `  Bull drivers: ${mc.bullDrivers.join("; ")}\n`;
    if (mc.bearDrivers.length) macroBlock += `  Bear drivers: ${mc.bearDrivers.join("; ")}\n`;
    if (mc.watchNext.length) macroBlock += `  Watch next: ${mc.watchNext.join("; ")}\n`;
    macroBlock += "\n";
  }

  const prompt = `You are an AI technical setup interpreter. Analyze ONLY the indicators the user has enabled on their chart. Do not comment on indicators that are not active.

CHART CONTEXT:
  Symbol: ${input.symbol}
  Price: $${input.price.toFixed(2)}
  Range: ${input.range}  |  Interval: ${input.interval}  |  Type: ${input.chartType}

${indicatorBlock}
${macroBlock}Respond ONLY with a valid JSON object (no markdown fences):
{
  "bias": "Bullish" | "Bearish" | "Neutral" | "Mixed",
  "regime": "1 sentence: what type of setup is this? (e.g., 'trending with momentum confirmation', 'range-bound with conflicting signals')",
  "bullishEvidence": ["2-4 specific bullish signals from the ACTIVE indicators above — cite the numbers"],
  "bearishEvidence": ["2-4 specific bearish signals or caution flags — cite the numbers"],
  "conflicts": ["0-2 signal conflicts between active indicators, if any"],
  "confirmsNext": "1 sentence: what specific price action or indicator reading would confirm the current bias?",
  "invalidatesNext": "1 sentence: what would invalidate the current setup?"
}

RULES:
- ONLY reference indicators listed above — never analyse inactive ones
- Use the [structured] fields for precise crossover/zone/trend data when available
- Cite specific values (RSI at 72, MACD histogram at +0.45, Pitchfork position at +65% from median, etc.)
- When Pitchfork is active: interpret the position field (near-median = mean reversion zone, upper/lower warning = extended), note whether price is reverting, and consider median slope direction
- When macro context is provided: note agreement or conflict between the macro regime and the technical setup (e.g., bullish technicals in a Risk-Off macro = conflict worth noting)
- If macro confidence is Low or data is STALE, note this uncertainty rather than relying heavily on macro signals
- Be trader-friendly and concise
- Do not predict price targets
- Do not give buy/sell advice
- Frame as interpretation and scenario analysis
- If indicators conflict, say so directly — do not force a narrative
- If few indicators are active, keep the analysis proportionally brief`;

  try {
    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });

    const text = (response.text ?? "").trim();
    if (!text) throw new Error("Gemini returned empty response");

    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
    const parsed = JSON.parse(cleaned);

    return {
      bias: parsed.bias ?? "Neutral",
      regime: parsed.regime ?? "",
      bullishEvidence: parsed.bullishEvidence ?? [],
      bearishEvidence: parsed.bearishEvidence ?? [],
      conflicts: parsed.conflicts ?? [],
      confirmsNext: parsed.confirmsNext ?? "",
      invalidatesNext: parsed.invalidatesNext ?? "",
      generatedAt: new Date().toISOString(),
      source: "gemini",
      indicatorsUsed,
      context: ctx,
      hasMacroContext,
    };
  } catch (err) {
    console.error("[gemini] Setup analysis failed:", (err as Error).message);
    return fallbackSetupAnalysis(input, indicatorsUsed, ctx, hasMacroContext);
  }
}

function fallbackSetupAnalysis(
  input: SetupAnalysisInput,
  indicatorsUsed: string[],
  ctx: SetupAnalysis["context"],
  hasMacroContext: boolean,
): SetupAnalysis {
  const bullish: string[] = [];
  const bearish: string[] = [];
  const conflicts: string[] = [];

  for (const ind of input.activeIndicators) {
    const s = ind.state.toLowerCase();
    // Use structured pitchfork data for richer fallback
    if (ind.structured?.pitchfork) {
      const pf = ind.structured.pitchfork;
      if (pf.medianSlope === "rising" && (pf.position === "near-median" || pf.position === "lower-half")) {
        bullish.push(`Pitchfork: price in ${pf.position.replace(/-/g, " ")} with rising median — potential support`);
      } else if (pf.medianSlope === "falling" && (pf.position === "near-median" || pf.position === "upper-half")) {
        bearish.push(`Pitchfork: price in ${pf.position.replace(/-/g, " ")} with falling median — potential resistance`);
      }
      if (pf.position === "above-upper-warning" || pf.position === "upper-warning-zone") {
        bearish.push(`Pitchfork: price extended into ${pf.position.replace(/-/g, " ")} (${pf.distFromMedianPct}% from median)`);
      }
      if (pf.position === "below-lower-warning" || pf.position === "lower-warning-zone") {
        bullish.push(`Pitchfork: price extended into ${pf.position.replace(/-/g, " ")} — potential mean reversion zone`);
      }
      if (pf.reverting) {
        const revertDir = pf.distFromMedianPct > 0 ? "down toward" : "up toward";
        bullish.push(`Pitchfork: price reverting ${revertDir} median`);
      }
    } else if (s.includes("bullish") || s.includes("overbought") || s.includes("above")) {
      bullish.push(`${ind.name}: ${ind.state}`);
    } else if (s.includes("bearish") || s.includes("oversold") || s.includes("below")) {
      bearish.push(`${ind.name}: ${ind.state}`);
    }
  }

  // Use structured macro for richer fallback
  if (input.macroContext) {
    const mc = input.macroContext;
    if (mc.regime === "Risk-On") bullish.push(`Macro regime: ${mc.regime}`);
    else if (mc.regime === "Risk-Off") bearish.push(`Macro regime: ${mc.regime}`);
    if (mc.volatility && mc.volatility.regime === "extreme") bearish.push(`VIX elevated at ${mc.volatility.vix.toFixed(1)}`);
  }

  if (bullish.length > 0 && bearish.length > 0) {
    conflicts.push("Mixed signals across active indicators");
  }

  // Check for macro vs technical conflict
  if (input.macroContext) {
    const techBias = bullish.length > bearish.length ? "bullish" : bearish.length > bullish.length ? "bearish" : "mixed";
    if ((input.macroContext.regime === "Risk-Off" && techBias === "bullish") ||
        (input.macroContext.regime === "Risk-On" && techBias === "bearish")) {
      conflicts.push(`Macro regime (${input.macroContext.regime}) conflicts with technical setup (${techBias})`);
    }
  }

  const bias = bullish.length > bearish.length ? "Bullish"
    : bearish.length > bullish.length ? "Bearish"
    : input.activeIndicators.length > 0 ? "Mixed" : "Neutral";

  return {
    bias,
    regime: input.activeIndicators.length > 0
      ? `${input.activeIndicators.length} indicator(s) active — rule-based summary`
      : "No advanced indicators active — price action only",
    bullishEvidence: bullish.length > 0 ? bullish : ["No clear bullish signals from active indicators"],
    bearishEvidence: bearish.length > 0 ? bearish : ["No clear bearish signals from active indicators"],
    conflicts,
    confirmsNext: "Configure GEMINI_API_KEY for AI-powered setup interpretation",
    invalidatesNext: "Configure GEMINI_API_KEY for AI-powered setup interpretation",
    generatedAt: new Date().toISOString(),
    source: "fallback",
    indicatorsUsed,
    context: ctx,
    hasMacroContext,
  };
}

// ─── Fallback (no API key or Gemini error) ──────────────────────────────────

function fallbackAnalysis(params: {
  symbol: string;
  indicators: TechnicalIndicators;
}): AIAnalysis {
  const { symbol, indicators } = params;
  const bullish = indicators.trendRegime.includes("Uptrend");

  return {
    bullCase: [
      bullish
        ? `${symbol} is in a confirmed uptrend with MA50 above MA200`
        : "Oversold conditions may present a mean-reversion opportunity",
      `RSI at ${indicators.rsi} is ${indicators.rsi > 50 ? "in bullish momentum territory" : "building base"}`,
      `Relative volume of ${indicators.relativeVolume}x ${indicators.relativeVolume > 1 ? "confirms institutional activity" : "needs improvement"}`,
    ],
    bearCase: [
      !bullish ? `${symbol} is trading below key moving averages` : "Extended position above MA50 raises pullback risk",
      indicators.rsi > 70 ? "RSI in overbought territory — momentum may cool" : "Volume confirmation lacking for a strong move",
      "Broader market risk could pressure this name regardless of fundamentals",
    ],
    risks: [
      "AI analysis unavailable — showing rule-based fallback",
      "Configure GEMINI_API_KEY in .env.local for full AI-powered analysis",
    ],
    recommendation: indicators.setupScore >= 70 ? "Buy" : indicators.setupScore >= 50 ? "Neutral" : "Sell",
    confidence: "Low",
    summary: `${symbol} has a setup score of ${indicators.setupScore}/100 (${indicators.setupLabel}). Trend: ${indicators.trendRegime}. RSI: ${indicators.rsi}. This is a rule-based fallback — configure Gemini for AI analysis.`,
    generatedAt: new Date().toISOString(),
  };
}
