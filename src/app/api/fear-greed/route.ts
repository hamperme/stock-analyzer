import { NextResponse } from "next/server";
import { cache, TTL } from "@/lib/cache";
import type { FearGreedData, FearGreedLabel } from "@/lib/types";

function scoreToLabel(score: number): FearGreedLabel {
  if (score <= 25) return "Extreme Fear";
  if (score <= 45) return "Fear";
  if (score <= 55) return "Neutral";
  if (score <= 75) return "Greed";
  return "Extreme Greed";
}

function vixToScore(vix: number): number {
  // Inverse: high VIX = fear (low score), low VIX = greed (high score)
  if (vix <= 12) return 85;
  if (vix <= 15) return 72;
  if (vix <= 18) return 60;
  if (vix <= 22) return 48;
  if (vix <= 27) return 35;
  if (vix <= 32) return 22;
  return 10;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchYahoo(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function GET() {
  const cacheKey = "fear-greed";
  const cached = cache.get<FearGreedData>(cacheKey);
  if (cached) return NextResponse.json({ data: cached, error: null });

  try {
    const [vixJson, spJson] = await Promise.all([
      fetchYahoo(
        "https://query1.finance.yahoo.com/v11/finance/quoteSummary/%5EVIX?modules=price"
      ),
      fetchYahoo(
        "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=6mo"
      ),
    ]);

    // VIX current value
    const vixPrice = vixJson?.quoteSummary?.result?.[0]?.price ?? {};
    const vix: number = vixPrice.regularMarketPrice?.raw ?? 20;
    const vixChange: number = (vixPrice.regularMarketChangePercent?.raw ?? 0) * 100;

    // S&P 500 — 125-day MA momentum
    const chartResult = spJson?.chart?.result?.[0];
    const spCloses: number[] = (chartResult?.indicators?.quote?.[0]?.close ?? []).filter(
      (v: unknown) => v != null
    );
    const sp125MA =
      spCloses.length >= 125
        ? spCloses.slice(-125).reduce((a: number, b: number) => a + b, 0) / 125
        : spCloses[spCloses.length - 1] ?? 0;
    const spCurrent = spCloses[spCloses.length - 1] ?? 0;
    const spMomentum =
      sp125MA > 0 ? Math.round(((spCurrent - sp125MA) / sp125MA) * 1000) / 10 : 0;

    // Composite score (50% VIX, 50% S&P momentum)
    const momentumScore = Math.max(0, Math.min(100, 50 + spMomentum * 2));
    const vixScore = vixToScore(vix);
    const score = Math.round((momentumScore * 0.5 + vixScore * 0.5));

    const data: FearGreedData = {
      score: Math.max(0, Math.min(100, score)),
      label: scoreToLabel(score),
      vix: Math.round(vix * 100) / 100,
      vixChange: Math.round(vixChange * 100) / 100,
      spMomentum,
    };

    cache.set(cacheKey, data, TTL.FEAR_GREED);
    return NextResponse.json({ data, error: null });
  } catch (err) {
    console.error("[fear-greed]", err);
    return NextResponse.json(
      { data: null, error: "Failed to compute Fear & Greed Index" },
      { status: 500 }
    );
  }
}
