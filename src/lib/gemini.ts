import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIAnalysis, TechnicalIndicators, NewsItem } from "./types";

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenerativeAI(key);
}

// ─── Stock Analysis ───────────────────────────────────────────────────────────

export async function generateStockAnalysis(params: {
  symbol: string;
  shortName: string;
  price: number;
  changePercent: number;
  indicators: TechnicalIndicators;
  newsHeadlines: string[];
}): Promise<AIAnalysis> {
  const client = getClient();

  if (!client) {
    return fallbackAnalysis(params);
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
    const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
    const parsed = JSON.parse(cleaned) as AIAnalysis;

    return {
      ...parsed,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[gemini] Analysis generation failed:", err);
    return fallbackAnalysis(params);
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
    const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `In 1-2 sentences, summarize what this headline means for $${symbol} investors: "${title}". Be direct and analytical.`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch {
    return "";
  }
}

// ─── Fallback (no API key) ────────────────────────────────────────────────────

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
      "No Gemini API key configured — AI analysis is rule-based only",
      "Add GEMINI_API_KEY to .env.local for full AI-powered analysis",
    ],
    recommendation: indicators.setupScore >= 70 ? "Buy" : indicators.setupScore >= 50 ? "Neutral" : "Sell",
    confidence: "Low",
    summary: `${symbol} has a setup score of ${indicators.setupScore}/100 (${indicators.setupLabel}). Trend: ${indicators.trendRegime}. RSI: ${indicators.rsi}. Configure your Gemini API key for a comprehensive AI analysis.`,
    generatedAt: new Date().toISOString(),
  };
}
