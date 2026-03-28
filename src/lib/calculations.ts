import type { TechnicalIndicators, HistoricalBar } from "./types";

// ─── Moving Averages ──────────────────────────────────────────────────────────

export function calculateSMA(prices: number[], period: number): number[] {
  const result: number[] = new Array(prices.length).fill(NaN);
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    result[i] = sum / period;
  }
  return result;
}

export function lastSMA(prices: number[], period: number): number {
  if (prices.length < period) return NaN;
  const slice = prices.slice(prices.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ─── RSI ──────────────────────────────────────────────────────────────────────

export function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const delta = prices[i] - prices[i - 1];
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

// ─── Relative Volume ──────────────────────────────────────────────────────────

export function calculateRelativeVolume(
  volumes: number[],
  currentVolume: number,
  lookback = 20
): number {
  if (volumes.length < lookback) return 1;
  const recent = volumes.slice(volumes.length - lookback);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (avg === 0) return 1;
  return Math.round((currentVolume / avg) * 100) / 100;
}

// ─── Setup Score ──────────────────────────────────────────────────────────────

export function calculateSetupScore(params: {
  price: number;
  ma20: number;
  ma50: number;
  ma200: number;
  rsi: number;
  relativeVolume: number;
}): number {
  const { price, ma20, ma50, ma200, rsi, relativeVolume } = params;
  let score = 0;

  // Trend health — 30 pts
  if (ma50 > ma200) score += 15; // golden cross
  if (price > ma50) score += 10;
  if (price > ma20) score += 5;

  // RSI momentum — 25 pts
  if (rsi >= 45 && rsi <= 65) score += 25;
  else if ((rsi >= 35 && rsi < 45) || (rsi > 65 && rsi <= 72)) score += 15;
  else if (rsi > 72 && rsi <= 80) score += 8;
  else if (rsi > 80) score += 3;
  else score += 5; // oversold bounce potential

  // Volume confirmation — 25 pts
  if (relativeVolume >= 2.0) score += 25;
  else if (relativeVolume >= 1.5) score += 20;
  else if (relativeVolume >= 1.2) score += 15;
  else if (relativeVolume >= 1.0) score += 10;
  else score += 5;

  // Price structure vs MA50 — 20 pts
  const distPct = ma50 > 0 ? ((price - ma50) / ma50) * 100 : 0;
  if (distPct >= 0 && distPct <= 5) score += 20; // ideal buy zone
  else if (distPct > 5 && distPct <= 10) score += 12; // slightly extended
  else if (distPct > 10) score += 4; // overextended
  else if (distPct > -5) score += 12; // near MA50 support
  else if (distPct > -10) score += 6;
  else score += 2;

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ─── Trend Regime ─────────────────────────────────────────────────────────────

export function determineTrendRegime(
  price: number,
  ma50: number,
  ma200: number
): TechnicalIndicators["trendRegime"] {
  if (price > ma50 && ma50 > ma200) return "Strong Uptrend";
  if (price > ma200 && price < ma50) return "Uptrend";
  if (price < ma50 && ma50 > ma200) return "Sideways";
  if (price < ma200 && ma50 < ma200) return "Downtrend";
  return "Strong Downtrend";
}

// ─── Full Indicator Suite from Historical Bars ────────────────────────────────

export function computeIndicators(
  bars: HistoricalBar[],
  currentVolume?: number
): TechnicalIndicators {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  const rsi = calculateRSI(closes);
  const ma20 = lastSMA(closes, 20);
  const ma50 = lastSMA(closes, 50);
  const ma200 = lastSMA(closes, 200);
  const price = closes[closes.length - 1];

  const latestVol = currentVolume ?? volumes[volumes.length - 1];
  const relativeVolume = calculateRelativeVolume(
    volumes.slice(0, volumes.length - 1),
    latestVol
  );

  const priceVsMa50Pct =
    ma50 > 0 ? Math.round(((price - ma50) / ma50) * 1000) / 10 : 0;
  const priceVsMa200Pct =
    ma200 > 0 ? Math.round(((price - ma200) / ma200) * 1000) / 10 : 0;

  const setupScore = calculateSetupScore({ price, ma20, ma50, ma200, rsi, relativeVolume });
  const setupLabel =
    setupScore >= 80
      ? "Strong Setup"
      : setupScore >= 60
      ? "Watch"
      : setupScore >= 40
      ? "Neutral"
      : "Avoid";

  const high52w = Math.max(...closes.slice(-252));
  const low52w = Math.min(...closes.slice(-252));
  const distFrom52wHighPct =
    high52w > 0 ? Math.round(((price - high52w) / high52w) * 1000) / 10 : 0;

  return {
    rsi,
    relativeVolume,
    trendRegime: determineTrendRegime(price, ma50, ma200),
    ma20: Math.round(ma20 * 100) / 100,
    ma50: Math.round(ma50 * 100) / 100,
    ma200: Math.round(ma200 * 100) / 100,
    priceVsMa50Pct,
    priceVsMa200Pct,
    setupScore,
    setupLabel,
    high52w: Math.round(high52w * 100) / 100,
    low52w: Math.round(low52w * 100) / 100,
    distFrom52wHighPct,
  };
}

// ─── Enrich Historical Bars with MA lines ─────────────────────────────────────

export function enrichBarsWithMAs(bars: HistoricalBar[]) {
  const closes = bars.map((b) => b.close);
  const ma20s = calculateSMA(closes, 20);
  const ma50s = calculateSMA(closes, 50);
  const ma200s = calculateSMA(closes, 200);

  return bars.map((bar, i) => ({
    ...bar,
    ma20: isNaN(ma20s[i]) ? undefined : Math.round(ma20s[i] * 100) / 100,
    ma50: isNaN(ma50s[i]) ? undefined : Math.round(ma50s[i] * 100) / 100,
    ma200: isNaN(ma200s[i]) ? undefined : Math.round(ma200s[i] * 100) / 100,
  }));
}
