/**
 * AI generation helpers for Gemini, OpenAI, and Claude.
 *
 * Prompts and fallback logic live here so multiple providers can share the
 * same analysis behavior while keeping the rest of the app provider-agnostic.
 */

import { GoogleGenAI } from "@google/genai";
import { getAssetNoun } from "./assets";
import { getAiProviderApiKey, getAiProviderLabel, getAiProviderModel, getAiProviderStatuses, resolveAiProvider } from "./ai-provider-server";
import type { AppAiProvider } from "./app-settings";
import type { AIAnalysis, TechnicalIndicators, MacroView, MacroSnapshot, SetupAnalysis, SetupAnalysisInput } from "./types";

function getGeminiClient(): GoogleGenAI | null {
  const key = getAiProviderApiKey("gemini");
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

/** Exported so routes/debug can inspect configuration. */
export function getGeminiStatus() {
  const status = getAiProviderStatuses().gemini;
  return {
    hasKey: status.available,
    model: status.model,
  };
}

export function getAiStatus(requested?: string | null) {
  const { provider, availableProviders, status } = resolveAiProvider(requested);
  return {
    provider,
    label: status.label,
    hasKey: status.available,
    model: status.model,
    availableProviders,
    providers: getAiProviderStatuses(),
  };
}

// ─── Stock Analysis ───────────────────────────────────────────────────────────

export interface GenerateResult {
  analysis: AIAnalysis;
  /** provider id if AI was called, "fallback" if rule-based */
  source: AppAiProvider | "fallback";
  /** Non-null when source === "fallback" due to an error */
  providerError: string | null;
}

async function generateTextWithGemini(prompt: string): Promise<string> {
  const client = getGeminiClient();
  if (!client) throw new Error("GEMINI_API_KEY not set");

  const response = await client.models.generateContent({
    model: getAiProviderModel("gemini"),
    contents: prompt,
  });

  return (response.text ?? "").trim();
}

function extractOpenAiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  if (Array.isArray(record.output)) {
    return record.output
      .flatMap((item) => Array.isArray(item.content) ? item.content : [])
      .map((item) => (item?.type === "output_text" || item?.type === "text") && typeof item.text === "string" ? item.text : "")
      .join("\n")
      .trim();
  }

  return "";
}

function extractProviderErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return fallback;
}

async function generateTextWithOpenAI(prompt: string): Promise<string> {
  const apiKey = getAiProviderApiKey("openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getAiProviderModel("openai"),
      input: prompt,
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractProviderErrorMessage(json, `HTTP ${res.status}`));
  }

  const text = extractOpenAiText(json);
  if (!text) throw new Error("OpenAI returned empty response");
  return text;
}

async function generateTextWithAnthropic(prompt: string): Promise<string> {
  const apiKey = getAiProviderApiKey("anthropic");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getAiProviderModel("anthropic"),
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractProviderErrorMessage(json, `HTTP ${res.status}`));
  }

  if (!json || typeof json !== "object" || !("content" in json) || !Array.isArray(json.content)) {
    throw new Error("Anthropic returned malformed response");
  }

  const text = json.content
    .map((item: unknown) =>
      item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string"
        ? item.text
        : ""
    )
    .join("\n")
    .trim();

  if (!text) throw new Error("Anthropic returned empty response");
  return text;
}

async function generateTextWithProvider(provider: AppAiProvider, prompt: string): Promise<string> {
  switch (provider) {
    case "gemini":
      return generateTextWithGemini(prompt);
    case "openai":
      return generateTextWithOpenAI(prompt);
    case "anthropic":
      return generateTextWithAnthropic(prompt);
  }
}

function getResponseLanguage(locale: "en" | "zh"): string {
  return locale === "zh" ? "Simplified Chinese" : "English";
}

function stockAnalysisLanguageRules(locale: "en" | "zh"): string {
  if (locale === "zh") {
    return `LANGUAGE:
- Write bullCase, bearCase, risks, summary, targetEntry, and stopLoss in Simplified Chinese.
- Keep recommendation and confidence exactly in English as required by the schema.`;
  }

  return `LANGUAGE:
- Write all free-text fields in English.
- Keep recommendation and confidence exactly in English as required by the schema.`;
}

function setupAnalysisLanguageRules(locale: "en" | "zh"): string {
  if (locale === "zh") {
    return `LANGUAGE:
- Write summary, interpretations, and caveats in Simplified Chinese.`;
  }

  return `LANGUAGE:
- Write summary, interpretations, and caveats in English.`;
}

export async function generateStockAnalysis(params: {
  symbol: string;
  assetType: "stock" | "crypto";
  shortName: string;
  price: number;
  changePercent: number;
  indicators: TechnicalIndicators;
  newsHeadlines: string[];
  locale?: "en" | "zh";
  provider?: AppAiProvider;
}): Promise<GenerateResult> {
  const locale = params.locale ?? "en";
  const { provider, availableProviders } = resolveAiProvider(params.provider);

  if (availableProviders.length === 0) {
    return {
      analysis: fallbackAnalysis({ ...params, provider, noProviderConfigured: true }),
      source: "fallback",
      providerError: "No AI provider API key configured",
    };
  }

  const { symbol, assetType, shortName, price, changePercent, indicators, newsHeadlines } = params;
  const assetNoun = getAssetNoun(assetType);
  const marketLabel = assetType === "crypto" ? "digital asset" : "stock";
  const riskContext = assetType === "crypto"
    ? "Broader crypto market risk and sentiment shifts can overwhelm individual token setups"
    : "Broader market risk could pressure this name regardless of fundamentals";

  const prompt = `You are an expert quantitative market analyst. Analyze this ${assetNoun} and return a JSON object.

ASSET: ${symbol} (${shortName})
TYPE: ${marketLabel}
PRICE: $${price.toFixed(2)} (${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}% today)
RISK CONTEXT: ${riskContext}

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

TARGET RESPONSE LANGUAGE: ${getResponseLanguage(locale)}
${stockAnalysisLanguageRules(locale)}

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
    const text = await generateTextWithProvider(provider, prompt);

    if (!text) {
      throw new Error(`${getAiProviderLabel(provider)} returned empty response`);
    }

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
    const parsed = JSON.parse(cleaned) as AIAnalysis;

    return {
      analysis: {
        ...parsed,
        generatedAt: new Date().toISOString(),
        locale,
        source: provider,
      },
      source: provider,
      providerError: null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ai/${provider}] Analysis generation failed:`, errMsg);
    return {
      analysis: fallbackAnalysis({ ...params, provider, noProviderConfigured: false }),
      source: "fallback",
      providerError: errMsg,
    };
  }
}

// ─── News Summarization ───────────────────────────────────────────────────────

export async function summarizeNewsItem(
  title: string,
  symbol: string
): Promise<string> {
  const client = getGeminiClient();
  if (!client) return "";

  try {
    const response = await client.models.generateContent({
      model: getAiProviderModel("gemini"),
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

export async function generateMacroView(
  snapshot: MacroSnapshot,
  requestedProvider?: AppAiProvider
): Promise<MacroView> {
  const { provider, availableProviders } = resolveAiProvider(requestedProvider);
  const { context, dataSources } = buildSnapshotContext(snapshot);

  if (availableProviders.length === 0) {
    return fallbackMacroView(snapshot, dataSources, true);
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
    const text = await generateTextWithProvider(provider, prompt);
    if (!text) throw new Error(`${getAiProviderLabel(provider)} returned empty response`);

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
      source: provider,
      dataSources,
      snapshot,
    };
  } catch (err) {
    console.error(`[ai/${provider}] Macro view generation failed:`, (err as Error).message);
    return fallbackMacroView(snapshot, dataSources, false);
  }
}

function fallbackMacroView(
  snap: MacroSnapshot,
  dataSources: string[],
  noProviderConfigured = false
): MacroView {
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
  const fallbackTail = noProviderConfigured
    ? "Rule-based summary — configure GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY for AI-synthesized views."
    : "Rule-based summary — the selected AI provider did not return a usable response this time.";
  const neutralSummary = `Market showing ${parts.join(", ")}. ${br.assessment ? `Breadth is ${br.assessment.toLowerCase()} (${br.source}).` : ""} ${fallbackTail}`.trim();

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
  const { provider, availableProviders } = resolveAiProvider(input.provider);
  const indicatorsUsed = input.activeIndicators.map((i) => i.name);
  const ctx = { symbol: input.symbol, range: input.range, interval: input.interval, chartType: input.chartType };
  const locale = input.locale ?? "en";

  const hasMacroContext = !!input.macroContext;

  if (availableProviders.length === 0) {
    return fallbackSetupAnalysis(input, indicatorsUsed, ctx, hasMacroContext, "missing_key");
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
  Asset Type: ${input.assetType ?? "stock"}
  Price: $${input.price.toFixed(2)}
  Range: ${input.range}  |  Interval: ${input.interval}  |  Type: ${input.chartType}

${indicatorBlock}
${macroBlock}TARGET RESPONSE LANGUAGE: ${getResponseLanguage(locale)}
${setupAnalysisLanguageRules(locale)}

Respond ONLY with a valid JSON object (no markdown fences):
{
  "summary": "2-4 sentence plain-language interpretation of what the currently enabled indicators are saying together",
  "interpretations": ["1 sentence per active indicator or meaningful signal cluster — cite the values"],
  "caveats": ["0-2 short notes about conflicts, uncertainty, or stale macro context if relevant"]
}

RULES:
- ONLY reference indicators listed above — never analyse inactive ones
- Use the [structured] fields for precise crossover/zone/trend data when available
- Cite specific values (RSI at 72, MACD histogram at +0.45, Pitchfork position at +65% from median, etc.)
- When Pitchfork is active: interpret the position field (near-median = mean reversion zone, upper/lower warning = extended), note whether price is reverting, and consider median slope direction
- When macro context is provided: note agreement or conflict between the macro regime and the technical setup (e.g., bullish technicals in a Risk-Off macro = conflict worth noting)
- If macro confidence is Low or data is STALE, note this uncertainty rather than relying heavily on macro signals
- Be trader-friendly and concise
- Do not split the answer into bullish and bearish sections
- Do not predict price targets
- Do not give buy/sell advice
- Frame as interpretation and scenario analysis
- If indicators conflict, say so directly — do not force a narrative
- If few indicators are active, keep the analysis proportionally brief`;

  try {
    const text = await generateTextWithProvider(provider, prompt);
    if (!text) throw new Error(`${getAiProviderLabel(provider)} returned empty response`);

    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
    const parsed = JSON.parse(cleaned);

    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : typeof parsed.regime === "string"
        ? parsed.regime.trim()
        : "";
    const interpretations = Array.isArray(parsed.interpretations)
      ? parsed.interpretations.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
      : [
          ...(Array.isArray(parsed.bullishEvidence) ? parsed.bullishEvidence : []),
          ...(Array.isArray(parsed.bearishEvidence) ? parsed.bearishEvidence : []),
        ].filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0);
    const caveats = Array.isArray(parsed.caveats)
      ? parsed.caveats.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
      : (Array.isArray(parsed.conflicts) ? parsed.conflicts : []).filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0);

    return {
      summary,
      interpretations,
      caveats,
      generatedAt: new Date().toISOString(),
      source: provider,
      indicatorsUsed,
      context: ctx,
      hasMacroContext,
    };
  } catch (err) {
    console.error(`[ai/${provider}] Setup analysis failed:`, (err as Error).message);
    return fallbackSetupAnalysis(input, indicatorsUsed, ctx, hasMacroContext, "generation_failed");
  }
}

function fallbackSetupAnalysis(
  input: SetupAnalysisInput,
  indicatorsUsed: string[],
  ctx: SetupAnalysis["context"],
  hasMacroContext: boolean,
  fallbackReason: "missing_key" | "generation_failed",
): SetupAnalysis {
  const locale = input.locale ?? "en";
  const isZh = locale === "zh";
  const interpretations: string[] = [];
  const caveats: string[] = [];
  let constructiveSignals = 0;
  let cautionSignals = 0;

  for (const ind of input.activeIndicators) {
    const s = ind.state.toLowerCase();
    // Use structured pitchfork data for richer fallback
    if (ind.structured?.pitchfork) {
      const pf = ind.structured.pitchfork;
      if (pf.medianSlope === "rising" && (pf.position === "near-median" || pf.position === "lower-half")) {
        constructiveSignals += 1;
        interpretations.push(
          isZh
            ? `Pitchfork：价格位于${pf.position.replace(/-/g, " ")}，中轴上行，可能形成支撑`
            : `Pitchfork: price in ${pf.position.replace(/-/g, " ")} with rising median — potential support`
        );
      } else if (pf.medianSlope === "falling" && (pf.position === "near-median" || pf.position === "upper-half")) {
        cautionSignals += 1;
        interpretations.push(
          isZh
            ? `Pitchfork：价格位于${pf.position.replace(/-/g, " ")}，中轴下行，可能形成阻力`
            : `Pitchfork: price in ${pf.position.replace(/-/g, " ")} with falling median — potential resistance`
        );
      }
      if (pf.position === "above-upper-warning" || pf.position === "upper-warning-zone") {
        cautionSignals += 1;
        interpretations.push(
          isZh
            ? `Pitchfork：价格已延伸至${pf.position.replace(/-/g, " ")}（距离中轴 ${pf.distFromMedianPct}%）`
            : `Pitchfork: price extended into ${pf.position.replace(/-/g, " ")} (${pf.distFromMedianPct}% from median)`
        );
      }
      if (pf.position === "below-lower-warning" || pf.position === "lower-warning-zone") {
        constructiveSignals += 1;
        interpretations.push(
          isZh
            ? `Pitchfork：价格已延伸至${pf.position.replace(/-/g, " ")}，可能进入均值回归区域`
            : `Pitchfork: price extended into ${pf.position.replace(/-/g, " ")} — potential mean reversion zone`
        );
      }
      if (pf.reverting) {
        const revertDir = pf.distFromMedianPct > 0
          ? (isZh ? "向下回归中轴" : "down toward")
          : (isZh ? "向上回归中轴" : "up toward");
        interpretations.push(
          isZh
            ? `Pitchfork：价格正在${revertDir}`
            : `Pitchfork: price reverting ${revertDir} median`
        );
      }
    } else {
      if (s.includes("bullish") || s.includes("above")) constructiveSignals += 1;
      if (s.includes("bearish") || s.includes("below") || s.includes("overbought") || s.includes("oversold")) cautionSignals += 1;
      interpretations.push(isZh ? `${ind.name}：${ind.state}` : `${ind.name}: ${ind.state}`);
    }
  }

  // Use structured macro for context notes instead of directional buckets
  if (input.macroContext) {
    const mc = input.macroContext;
    if (mc.regime === "Risk-On") {
      caveats.push(isZh ? `宏观环境偏支持风险资产（${mc.regime}）` : `Macro backdrop is more supportive for risk assets (${mc.regime})`);
    } else if (mc.regime === "Risk-Off") {
      caveats.push(isZh ? `宏观环境偏谨慎（${mc.regime}），技术信号需要更强确认` : `Macro backdrop is cautious (${mc.regime}), so technical readings may need stronger confirmation`);
    }
    if (mc.volatility && mc.volatility.regime === "extreme") {
      caveats.push(isZh ? `VIX 处于高位：${mc.volatility.vix.toFixed(1)}` : `VIX is elevated at ${mc.volatility.vix.toFixed(1)}`);
    }
    if (mc.isStale || mc.confidence === "Low") {
      caveats.push(isZh ? "宏观上下文置信度较低或数据偏旧，请降低对宏观部分的权重" : "Macro context is low-confidence or stale, so it should carry less weight");
    }
  }

  if (constructiveSignals > 0 && cautionSignals > 0) {
    caveats.push(isZh ? "当前启用指标之间存在分歧，读数更偏向拉锯而不是单边确认" : "The active indicators are not fully aligned, so the read is mixed rather than one-sided");
  }

  const missingKeyMessage = isZh
    ? "如需更细致的 AI 形态解读，请在 .env.local 中配置 GEMINI_API_KEY、OPENAI_API_KEY 或 ANTHROPIC_API_KEY"
    : "Configure GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env.local for AI-powered setup interpretation";
  const generationFailedMessage = isZh
    ? "所选 AI 提供方本次未成功返回可用结果，当前显示规则回退分析。可稍后重试。"
    : "The selected AI provider did not return a usable setup analysis this time, so a rule-based fallback is shown. Try again shortly.";
  caveats.push(fallbackReason === "missing_key" ? missingKeyMessage : generationFailedMessage);

  let summary: string;
  if (input.activeIndicators.length === 0) {
    summary = isZh
      ? "当前没有启用高级指标，因此这里没有额外的指标解读，主要仍是价格行为观察。"
      : "No advanced indicators are enabled right now, so there is no extra indicator read beyond price action.";
  } else if (constructiveSignals > cautionSignals) {
    summary = isZh
      ? `当前已启用 ${input.activeIndicators.length} 个指标，整体读数偏积极，但仍应结合后续价格确认。`
      : `There are ${input.activeIndicators.length} active indicators, and the combined read is leaning constructive, though it still needs price confirmation.`;
  } else if (cautionSignals > constructiveSignals) {
    summary = isZh
      ? `当前已启用 ${input.activeIndicators.length} 个指标，整体读数偏谨慎，说明趋势延续性仍需进一步确认。`
      : `There are ${input.activeIndicators.length} active indicators, and the combined read is leaning cautious, so trend continuation still needs confirmation.`;
  } else {
    summary = isZh
      ? `当前已启用 ${input.activeIndicators.length} 个指标，整体读数偏混合，更像震荡或等待确认阶段。`
      : `There are ${input.activeIndicators.length} active indicators, and the combined read is mixed, which looks more like a waiting or consolidation phase.`;
  }

  return {
    summary,
    interpretations,
    caveats,
    generatedAt: new Date().toISOString(),
    source: "fallback",
    fallbackReason,
    indicatorsUsed,
    context: ctx,
    hasMacroContext,
  };
}

// ─── Fallback (no API key or Gemini error) ──────────────────────────────────

function fallbackAnalysis(params: {
  symbol: string;
  assetType: "stock" | "crypto";
  indicators: TechnicalIndicators;
  locale?: "en" | "zh";
  provider?: AppAiProvider;
  noProviderConfigured?: boolean;
}): AIAnalysis {
  const { symbol, assetType, indicators } = params;
  const locale = params.locale ?? "en";
  const noProviderConfigured = params.noProviderConfigured ?? false;
  const bullish = indicators.trendRegime.includes("Uptrend");
  const participationLabel = assetType === "crypto" ? "market participation" : "institutional activity";
  const marketRiskLine = assetType === "crypto"
    ? "Broader crypto market risk and sentiment shifts can pressure this asset quickly"
    : "Broader market risk could pressure this name regardless of fundamentals";
  const providerLabel = params.provider ? getAiProviderLabel(params.provider) : "AI provider";

  if (locale === "zh") {
    const zhParticipationLabel = assetType === "crypto" ? "市场参与度" : "机构参与度";
    const zhMarketRiskLine = assetType === "crypto"
      ? "更广泛的加密市场风险和情绪波动，可能会迅速压制该资产走势"
      : "即使基本面稳定，整体市场风险也可能拖累该标的";
    const zhRiskMessage = noProviderConfigured
      ? "未检测到可用的 AI 提供方，当前显示规则回退结果"
      : `${providerLabel} 本次未成功返回可用结果，当前显示规则回退结果`;
    const zhConfigMessage = "请在 .env.local 中配置 GEMINI_API_KEY、OPENAI_API_KEY 或 ANTHROPIC_API_KEY 以启用完整 AI 分析";
    const zhSummaryTail = noProviderConfigured
      ? "当前摘要来自规则回退结果，如需 AI 分析请先配置可用的 AI 提供方。"
      : `当前摘要来自规则回退结果，${providerLabel} 本次未能成功完成分析。`;

    return {
      bullCase: [
        bullish
          ? `${symbol} 处于确认中的上升趋势，MA50 高于 MA200`
          : "超卖状态可能带来均值回归机会",
        `RSI 为 ${indicators.rsi}，${indicators.rsi > 50 ? "动能偏强" : "可能正在筑底"}`,
        `相对成交量为 ${indicators.relativeVolume}x，${indicators.relativeVolume > 1 ? `对${zhParticipationLabel}形成确认` : "仍需要更强的量能确认"}`,
      ],
      bearCase: [
        !bullish ? `${symbol} 目前位于关键均线下方` : "价格相对 MA50 已有一定延伸，回撤风险上升",
        indicators.rsi > 70 ? "RSI 处于超买区，短线动能可能降温" : "量能确认不足，强趋势仍需进一步验证",
        zhMarketRiskLine,
      ],
      risks: [
        zhRiskMessage,
        zhConfigMessage,
      ],
      recommendation: indicators.setupScore >= 70 ? "Buy" : indicators.setupScore >= 50 ? "Neutral" : "Sell",
      confidence: "Low",
      summary: `${symbol} 当前的 setup score 为 ${indicators.setupScore}/100（${indicators.setupLabel}）。趋势为 ${indicators.trendRegime}，RSI 为 ${indicators.rsi}。${zhSummaryTail}`,
      generatedAt: new Date().toISOString(),
      locale,
      source: "fallback",
    };
  }

  return {
    bullCase: [
      bullish
        ? `${symbol} is in a confirmed uptrend with MA50 above MA200`
        : "Oversold conditions may present a mean-reversion opportunity",
      `RSI at ${indicators.rsi} is ${indicators.rsi > 50 ? "in bullish momentum territory" : "building base"}`,
      `Relative volume of ${indicators.relativeVolume}x ${indicators.relativeVolume > 1 ? `confirms ${participationLabel}` : "needs improvement"}`,
    ],
    bearCase: [
      !bullish ? `${symbol} is trading below key moving averages` : "Extended position above MA50 raises pullback risk",
      indicators.rsi > 70 ? "RSI in overbought territory — momentum may cool" : "Volume confirmation lacking for a strong move",
      marketRiskLine,
    ],
    risks: [
      noProviderConfigured
        ? "No AI provider is configured — showing rule-based fallback"
        : `${providerLabel} did not return a usable result, so a rule-based fallback is shown`,
      "Configure GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in .env.local for full AI-powered analysis",
    ],
    recommendation: indicators.setupScore >= 70 ? "Buy" : indicators.setupScore >= 50 ? "Neutral" : "Sell",
    confidence: "Low",
    summary: `${symbol} has a setup score of ${indicators.setupScore}/100 (${indicators.setupLabel}). Trend: ${indicators.trendRegime}. RSI: ${indicators.rsi}. This ${assetType === "crypto" ? "digital asset" : "stock"} summary is rule-based fallback output${noProviderConfigured ? " because no AI provider is configured." : ` because ${providerLabel} did not return a usable response.`}`,
    generatedAt: new Date().toISOString(),
    locale,
    source: "fallback",
  };
}
