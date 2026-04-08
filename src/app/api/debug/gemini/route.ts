/**
 * GET /api/debug/gemini — test Gemini API connectivity.
 *
 * Returns:
 *  - API key present: true/false
 *  - Model name
 *  - Quick generation test (asks Gemini to return "hello")
 *  - Exact error message on failure
 */

import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getGeminiStatus } from "@/lib/gemini";
import { loadAnalysis } from "@/lib/store";

export async function GET() {
  const status = getGeminiStatus();

  // Check what's stored for AAPL as a sample
  const storedAAPL = loadAnalysis("AAPL");
  const storedSample = storedAAPL ? {
    hasStored: true,
    confidence: storedAAPL.data.confidence,
    risksSnippet: storedAAPL.data.risks?.[0]?.slice(0, 80) ?? null,
    isFallback: (storedAAPL.data.risks ?? []).join(" ").toLowerCase().includes("rule-based") ||
                (storedAAPL.data.risks ?? []).join(" ").toLowerCase().includes("no gemini"),
    ageMin: Math.round(storedAAPL.ageMs / 60_000),
  } : { hasStored: false };

  if (!status.hasKey) {
    return NextResponse.json({
      ...status,
      test: { ok: false, error: "GEMINI_API_KEY not set in .env.local" },
      storedAnalysisSample: storedSample,
    });
  }

  // Quick connectivity test: ask Gemini to say hello
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const response = await client.models.generateContent({
      model: status.model,
      contents: 'Respond with exactly: {"ok":true}',
    });
    const text = (response.text ?? "").trim();
    return NextResponse.json({
      ...status,
      test: { ok: true, rawResponse: text },
      storedAnalysisSample: storedSample,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ...status,
      test: { ok: false, error: errMsg },
      storedAnalysisSample: storedSample,
    });
  }
}
