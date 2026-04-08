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

// ─── EMA ─────────────────────────────────────────────────────────────────────

export function calculateEMA(prices: number[], period: number): number[] {
  const result: number[] = new Array(prices.length).fill(NaN);
  if (prices.length < period) return result;

  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  result[period - 1] = sum / period;

  const k = 2 / (period + 1);
  for (let i = period; i < prices.length; i++) {
    result[i] = prices[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ─── Bollinger Bands (period=20, stdDev=2) ───────────────────────────────────

export interface BollingerPoint {
  middle: number | undefined;
  upper: number | undefined;
  lower: number | undefined;
}

export function calculateBollingerBands(
  closes: number[],
  period = 20,
  mult = 2
): BollingerPoint[] {
  const result: BollingerPoint[] = new Array(closes.length).fill(null).map(() => ({
    middle: undefined,
    upper: undefined,
    lower: undefined,
  }));

  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;

    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mean) ** 2;
    const stdDev = Math.sqrt(variance / period);

    result[i] = {
      middle: Math.round(mean * 100) / 100,
      upper: Math.round((mean + mult * stdDev) * 100) / 100,
      lower: Math.round((mean - mult * stdDev) * 100) / 100,
    };
  }
  return result;
}

// ─── Stochastic Oscillator (%K=14, %D=3) ────────────────────────────────────

export interface StochasticPoint {
  k: number | undefined;
  d: number | undefined;
}

export function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3
): StochasticPoint[] {
  const len = closes.length;
  const rawK: number[] = new Array(len).fill(NaN);

  for (let i = kPeriod - 1; i < len; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    const range = hh - ll;
    rawK[i] = range === 0 ? 50 : ((closes[i] - ll) / range) * 100;
  }

  // %D = SMA of %K
  const result: StochasticPoint[] = new Array(len).fill(null).map(() => ({
    k: undefined,
    d: undefined,
  }));

  for (let i = kPeriod - 1; i < len; i++) {
    result[i].k = Math.round(rawK[i] * 100) / 100;
  }

  const startD = kPeriod - 1 + dPeriod - 1;
  for (let i = startD; i < len; i++) {
    let sum = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) sum += rawK[j];
    result[i].d = Math.round((sum / dPeriod) * 100) / 100;
  }

  return result;
}

// ─── MACD (fast=12, slow=26, signal=9) ──────────────────────────────────────

export interface MACDPoint {
  macd: number | undefined;
  signal: number | undefined;
  histogram: number | undefined;
}

export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDPoint[] {
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);

  const macdLine: number[] = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
      macdLine[i] = emaFast[i] - emaSlow[i];
    }
  }

  // Signal = EMA of MACD line (only where MACD is valid)
  const validStart = slowPeriod - 1;
  const macdValues = macdLine.slice(validStart);
  const signalEma = calculateEMA(macdValues, signalPeriod);

  const result: MACDPoint[] = new Array(closes.length).fill(null).map(() => ({
    macd: undefined,
    signal: undefined,
    histogram: undefined,
  }));

  for (let i = validStart; i < closes.length; i++) {
    const mi = i - validStart;
    const m = macdLine[i];
    const s = signalEma[mi];
    if (!isNaN(m)) {
      result[i].macd = Math.round(m * 1000) / 1000;
      if (!isNaN(s)) {
        result[i].signal = Math.round(s * 1000) / 1000;
        result[i].histogram = Math.round((m - s) * 1000) / 1000;
      }
    }
  }
  return result;
}

// ─── ADX (+DI, -DI, ADX) period=14 ──────────────────────────────────────────

export interface ADXPoint {
  adx: number | undefined;
  plusDI: number | undefined;
  minusDI: number | undefined;
}

export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): ADXPoint[] {
  const len = closes.length;
  const result: ADXPoint[] = new Array(len).fill(null).map(() => ({
    adx: undefined,
    plusDI: undefined,
    minusDI: undefined,
  }));

  if (len < period + 1) return result;

  // True Range, +DM, -DM
  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];

  for (let i = 1; i < len; i++) {
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));

    const upMove = h - highs[i - 1];
    const downMove = lows[i - 1] - l;

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Wilder smoothing
  let smoothTR = 0, smoothPlusDM = 0, smoothMinusDM = 0;
  for (let i = 1; i <= period; i++) {
    smoothTR += tr[i];
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
  }

  const dx: number[] = [];

  const calcDI = (idx: number) => {
    if (idx === period) {
      // first smoothed values already calculated
    } else {
      smoothTR = smoothTR - smoothTR / period + tr[idx];
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[idx];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[idx];
    }

    const pdi = smoothTR === 0 ? 0 : (smoothPlusDM / smoothTR) * 100;
    const mdi = smoothTR === 0 ? 0 : (smoothMinusDM / smoothTR) * 100;
    const diSum = pdi + mdi;
    const dxVal = diSum === 0 ? 0 : (Math.abs(pdi - mdi) / diSum) * 100;

    result[idx].plusDI = Math.round(pdi * 100) / 100;
    result[idx].minusDI = Math.round(mdi * 100) / 100;
    dx.push(dxVal);
  };

  // First DI at index=period
  calcDI(period);

  for (let i = period + 1; i < len; i++) {
    calcDI(i);
  }

  // ADX = Wilder-smoothed DX over `period` values
  if (dx.length >= period) {
    let adxSum = 0;
    for (let i = 0; i < period; i++) adxSum += dx[i];
    let adx = adxSum / period;
    result[period + period - 1].adx = Math.round(adx * 100) / 100;

    for (let i = period; i < dx.length; i++) {
      adx = (adx * (period - 1) + dx[i]) / period;
      const dataIdx = period + i;
      if (dataIdx < len) {
        result[dataIdx].adx = Math.round(adx * 100) / 100;
      }
    }
  }

  return result;
}

// ─── Rolling Standard Deviation of Returns (close-to-close %) ───────────────

export interface StdDevPoint {
  stdDev: number | undefined;
}

/**
 * Rolling standard deviation of close-to-close percentage returns.
 * Measures realized volatility over `period` bars.
 * Returns one value per bar (undefined for the first `period` bars).
 */
export function calculateRollingStdDev(
  closes: number[],
  period = 20
): StdDevPoint[] {
  const len = closes.length;
  const result: StdDevPoint[] = new Array(len).fill(null).map(() => ({ stdDev: undefined }));

  if (len < period + 1) return result;

  // Compute percentage returns: r[i] = (close[i] - close[i-1]) / close[i-1] * 100
  const returns: number[] = [NaN];
  for (let i = 1; i < len; i++) {
    returns.push(closes[i - 1] !== 0 ? ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100 : 0);
  }

  // Rolling std dev over `period` returns, starting at index period
  for (let i = period; i < len; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += returns[j];
    const mean = sum / period;

    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (returns[j] - mean) ** 2;

    result[i].stdDev = Math.round(Math.sqrt(variance / period) * 1000) / 1000;
  }

  return result;
}

// ─── Swing High / Swing Low Detection ───────────────────────────────────────

export interface SwingPoints {
  /** Highest close (swing high) in the dataset */
  swingHigh: number;
  /** Index of the swing high */
  swingHighIdx: number;
  /** Lowest close (swing low) in the dataset */
  swingLow: number;
  /** Index of the swing low */
  swingLowIdx: number;
}

/**
 * Auto-detect swing high and swing low from the visible range.
 * Uses highest high and lowest low from the OHLC data.
 *
 * NOTE: This is auto-anchored from the current visible range.
 * For future manual anchor selection, replace this function with
 * user-selected (swingHigh, swingLow) coordinates and feed them
 * directly into calculateFibLevels / calculateFibExtensionLevels.
 */
export function findSwingPoints(
  highs: number[],
  lows: number[]
): SwingPoints {
  let swingHigh = -Infinity;
  let swingHighIdx = 0;
  let swingLow = Infinity;
  let swingLowIdx = 0;

  for (let i = 0; i < highs.length; i++) {
    if (highs[i] > swingHigh) {
      swingHigh = highs[i];
      swingHighIdx = i;
    }
    if (lows[i] < swingLow) {
      swingLow = lows[i];
      swingLowIdx = i;
    }
  }

  return { swingHigh, swingHighIdx, swingLow, swingLowIdx };
}

// ─── Fibonacci Retracement Levels ───────────────────────────────────────────

export interface FibLevel {
  ratio: number;
  label: string;
  price: number;
}

/** Standard Fibonacci retracement ratios */
const FIB_RETRACEMENT_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/**
 * Calculate Fibonacci retracement levels between a swing high and swing low.
 * If price moved up (low happened before high), retracements are measured
 * downward from the high. If price moved down (high happened before low),
 * retracements are measured upward from the low.
 */
export function calculateFibRetracementLevels(
  swingHigh: number,
  swingLow: number,
  highFirst: boolean
): FibLevel[] {
  const range = swingHigh - swingLow;
  if (range <= 0) return [];

  if (highFirst) {
    // Downtrend: high came first, retracements go up from low
    return FIB_RETRACEMENT_RATIOS.map((ratio) => ({
      ratio,
      label: `${(ratio * 100).toFixed(1)}%`,
      price: Math.round((swingLow + range * ratio) * 100) / 100,
    }));
  } else {
    // Uptrend: low came first, retracements go down from high
    return FIB_RETRACEMENT_RATIOS.map((ratio) => ({
      ratio,
      label: `${(ratio * 100).toFixed(1)}%`,
      price: Math.round((swingHigh - range * ratio) * 100) / 100,
    }));
  }
}

// ─── Fibonacci Extension Levels ─────────────────────────────────────────────

/** Standard Fibonacci extension ratios (beyond the swing) */
const FIB_EXTENSION_RATIOS = [1.0, 1.272, 1.414, 1.618, 2.0, 2.618];

/**
 * Calculate Fibonacci extension levels beyond the swing range.
 * Extensions project beyond the original move.
 * If uptrend (low first → high), extensions project above the high.
 * If downtrend (high first → low), extensions project below the low.
 */
export function calculateFibExtensionLevels(
  swingHigh: number,
  swingLow: number,
  highFirst: boolean
): FibLevel[] {
  const range = swingHigh - swingLow;
  if (range <= 0) return [];

  if (highFirst) {
    // Downtrend: extensions project below the low
    return FIB_EXTENSION_RATIOS.map((ratio) => ({
      ratio,
      label: `${(ratio * 100).toFixed(1)}%`,
      price: Math.round((swingHigh - range * ratio) * 100) / 100,
    }));
  } else {
    // Uptrend: extensions project above the high
    return FIB_EXTENSION_RATIOS.map((ratio) => ({
      ratio,
      label: `${(ratio * 100).toFixed(1)}%`,
      price: Math.round((swingLow + range * ratio) * 100) / 100,
    }));
  }
}

// ─── Ichimoku Kinkō Hyō ─────────────────────────────────────────────────────

export interface IchimokuPoint {
  tenkan: number | undefined;   // Tenkan-sen (conversion line) — 9-period
  kijun: number | undefined;    // Kijun-sen (base line) — 26-period
  senkouA: number | undefined;  // Senkou Span A (leading span A) — shifted +26
  senkouB: number | undefined;  // Senkou Span B (leading span B) — shifted +26
  chikou: number | undefined;   // Chikou Span (lagging span) — shifted -26
}

/**
 * Helper: (highest high + lowest low) / 2 over `period` ending at index `i`.
 */
function midpoint(highs: number[], lows: number[], i: number, period: number): number | undefined {
  if (i < period - 1) return undefined;
  let hh = -Infinity;
  let ll = Infinity;
  for (let j = i - period + 1; j <= i; j++) {
    if (highs[j] > hh) hh = highs[j];
    if (lows[j] < ll) ll = lows[j];
  }
  return Math.round(((hh + ll) / 2) * 100) / 100;
}

/**
 * Calculate Ichimoku Kinkō Hyō components.
 *
 * Standard periods: Tenkan=9, Kijun=26, Senkou B=52, displacement=26.
 *
 * The returned array has `len + displacement` entries so that Senkou spans
 * (shifted forward by `displacement`) can be plotted beyond the current data.
 * Indices 0..len-1 correspond to the original bars.
 * Indices len..len+displacement-1 are "future" slots containing only senkouA/senkouB.
 *
 * The chart component should extend its data array with placeholder dates
 * for those future slots, or simply trim to `len` if it only wants the
 * current-range portion.
 */
export function calculateIchimoku(
  highs: number[],
  lows: number[],
  closes: number[],
  tenkanPeriod = 9,
  kijunPeriod = 26,
  senkouBPeriod = 52,
  displacement = 26
): IchimokuPoint[] {
  const len = closes.length;
  const totalLen = len + displacement;
  const result: IchimokuPoint[] = new Array(totalLen).fill(null).map(() => ({
    tenkan: undefined,
    kijun: undefined,
    senkouA: undefined,
    senkouB: undefined,
    chikou: undefined,
  }));

  // Tenkan-sen & Kijun-sen at each bar position
  for (let i = 0; i < len; i++) {
    result[i].tenkan = midpoint(highs, lows, i, tenkanPeriod);
    result[i].kijun = midpoint(highs, lows, i, kijunPeriod);

    // Senkou Span A = (Tenkan + Kijun) / 2, shifted forward by displacement
    const t = result[i].tenkan;
    const k = result[i].kijun;
    if (t !== undefined && k !== undefined) {
      result[i + displacement].senkouA = Math.round(((t + k) / 2) * 100) / 100;
    }

    // Senkou Span B = midpoint over senkouBPeriod, shifted forward by displacement
    const sb = midpoint(highs, lows, i, senkouBPeriod);
    if (sb !== undefined) {
      result[i + displacement].senkouB = sb;
    }

    // Chikou Span = close shifted backward by displacement
    if (i >= displacement) {
      result[i - displacement].chikou = closes[i];
    }
  }

  return result;
}

// ─── OHLCV Aggregation (daily → weekly / monthly) ──────────────────────────

/**
 * Aggregate daily bars into weekly candles.
 * Groups by ISO week (Mon–Fri). Each bucket becomes one candle:
 *   open = first bar's open, high = max, low = min, close = last bar's close,
 *   volume = sum, date = first trading day of the week.
 */
export function aggregateWeekly(bars: HistoricalBar[]): HistoricalBar[] {
  if (!bars.length) return [];

  const buckets = new Map<string, HistoricalBar[]>();
  for (const bar of bars) {
    const d = new Date(bar.date + "T00:00:00Z");
    // ISO week: roll back to Monday
    const day = d.getUTCDay(); // 0=Sun … 6=Sat
    const diff = day === 0 ? -6 : 1 - day; // offset to Monday
    const mon = new Date(d);
    mon.setUTCDate(mon.getUTCDate() + diff);
    const key = mon.toISOString().split("T")[0]; // Monday date as key
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(bar);
  }

  return Array.from(buckets.values()).map(aggregateBucket);
}

/**
 * Aggregate daily bars into monthly candles.
 * Groups by calendar month (YYYY-MM).
 */
export function aggregateMonthly(bars: HistoricalBar[]): HistoricalBar[] {
  if (!bars.length) return [];

  const buckets = new Map<string, HistoricalBar[]>();
  for (const bar of bars) {
    const key = bar.date.slice(0, 7); // "YYYY-MM"
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(bar);
  }

  return Array.from(buckets.values()).map(aggregateBucket);
}

/** Collapse an array of bars within one bucket into a single OHLCV candle. */
function aggregateBucket(bucket: HistoricalBar[]): HistoricalBar {
  return {
    date:   bucket[0].date,                              // first trading day
    open:   bucket[0].open,                              // first open
    high:   Math.round(Math.max(...bucket.map(b => b.high)) * 100) / 100,
    low:    Math.round(Math.min(...bucket.map(b => b.low))  * 100) / 100,
    close:  bucket[bucket.length - 1].close,             // last close
    volume: bucket.reduce((sum, b) => sum + b.volume, 0),
  };
}
