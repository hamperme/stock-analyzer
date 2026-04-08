// ─── Market Data ──────────────────────────────────────────────────────────────

export interface StockQuote {
  symbol: string;
  shortName: string;
  longName: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  marketCap: number | null;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  ma50: number;
  ma200: number;
  beta: number | null;
  currency: string;
}

export interface HistoricalBar {
  date: string; // ISO date string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartDataPoint extends HistoricalBar {
  ma20?: number;
  ma50?: number;
  ma200?: number;
}

// ─── Technical Analysis ───────────────────────────────────────────────────────

export interface TechnicalIndicators {
  rsi: number;
  relativeVolume: number;
  trendRegime: "Strong Uptrend" | "Uptrend" | "Downtrend" | "Strong Downtrend" | "Sideways";
  ma20: number;
  ma50: number;
  ma200: number;
  priceVsMa50Pct: number;
  priceVsMa200Pct: number;
  setupScore: number;
  setupLabel: "Strong Setup" | "Watch" | "Neutral" | "Avoid";
  high52w: number;
  low52w: number;
  distFrom52wHighPct: number;
}

export interface WatchlistEntry {
  symbol: string;
  shortName: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  relativeVolume: number;
  ma50: number;
  ma200: number;
  maAlignment: "bullish" | "bearish" | "mixed";
  rsi: number;
  setupScore: number;
  setupLabel: TechnicalIndicators["setupLabel"];
}

// ─── Market Indices ───────────────────────────────────────────────────────────

export interface MarketIndex {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

// ─── Fear & Greed ─────────────────────────────────────────────────────────────

export type FearGreedLabel = "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed";

export interface FearGreedData {
  score: number;
  label: FearGreedLabel;
  vix: number;
  vixChange: number;
  spMomentum: number; // % above/below 125-day MA
}

// ─── News ─────────────────────────────────────────────────────────────────────

export type NewsTag =
  | "Earnings"
  | "Product Launch"
  | "Legal"
  | "Partnership"
  | "Analyst Rating"
  | "Executive Change"
  | "Market Sentiment"
  | "General";

export interface NewsItem {
  title: string;
  summary: string;
  url: string;
  publisher: string;
  publishedAt: string;
  tag: NewsTag;
  sentiment: "positive" | "negative" | "neutral";
}

// ─── AI Analysis ──────────────────────────────────────────────────────────────

export type AIRecommendation = "Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell";
export type AIConfidence = "High" | "Medium" | "Low";

export interface AIAnalysis {
  bullCase: string[];
  bearCase: string[];
  risks: string[];
  recommendation: AIRecommendation;
  confidence: AIConfidence;
  summary: string;
  targetEntry?: string;
  stopLoss?: string;
  generatedAt: string;
}

// ─── Setup Analysis (chart-context AI interpretation) ────────────────────────

/** The structured payload sent from the chart to the setup-analysis endpoint */
export interface SetupAnalysisInput {
  symbol: string;
  price: number;
  range: string;
  interval: string;
  chartType: "line" | "candle";
  /** Only the indicators the user has actually enabled */
  activeIndicators: ActiveIndicatorSnapshot[];
  /** Structured macro regime context — null when unavailable */
  macroContext: MacroContextPayload | null;
}

/**
 * Concise structured macro context for the setup-analysis AI.
 * Extracted from the full MacroView + MacroSnapshot — only the fields
 * the setup interpreter actually needs.
 */
export interface MacroContextPayload {
  regime: MarketRegime;
  confidence: "High" | "Medium" | "Low";
  confidenceScore: number;
  isStale: boolean;
  /** Top 2–3 bullish macro drivers */
  bullDrivers: string[];
  /** Top 2–3 bearish macro drivers */
  bearDrivers: string[];
  /** 1–2 items to watch next */
  watchNext: string[];
  /** Short neutral-tone summary */
  summary: string;
  /** Policy path bias if available */
  policyBias: "Dovish" | "Neutral" | "Hawkish" | null;
  /** VIX level and regime label */
  volatility: { vix: number; regime: "low" | "elevated" | "high" | "extreme" } | null;
  /** Breadth assessment if available */
  breadth: "Broad" | "Healthy" | "Narrow" | "Very Narrow" | null;
  /** Fear & Greed score if available */
  fearGreed: { score: number; label: string } | null;
}

/** A single active indicator's current state */
export interface ActiveIndicatorSnapshot {
  name: string;
  /** Human-readable state summary, e.g. "K: 78, D: 65 — overbought" */
  state: string;
  /** Machine-readable structured fields for richer AI analysis */
  structured?: IndicatorStructuredData;
}

/** Typed structured data per indicator — only the relevant sub-object is populated */
export interface IndicatorStructuredData {
  bollinger?: {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
    /** 0–100: where price sits within the band (0 = at lower, 100 = at upper) */
    percentB: number;
  };
  stochastic?: {
    k: number;
    d: number;
    zone: "overbought" | "oversold" | "neutral";
    crossover: "bullish" | "bearish" | "none";
  };
  macd?: {
    macd: number;
    signal: number;
    histogram: number;
    histogramSign: "positive" | "negative" | "zero";
    crossover: "bullish" | "bearish" | "none";
  };
  adx?: {
    adx: number;
    plusDI: number;
    minusDI: number;
    trendStrength: "strong" | "trending" | "weak" | "none";
    direction: "bullish" | "bearish";
  };
  ichimoku?: {
    tenkanAboveKijun: boolean | null;
    priceVsCloud: "above" | "below" | "inside";
    cloudColor: "green" | "red" | null;
  };
  movingAverages?: {
    ma20: number;
    ma50: number | null;
    ma200: number | null;
    alignment: "bullish" | "bearish" | "mixed";
  };
  fibRetracement?: {
    nearestLevel: number;
    nearestPrice: number;
    priceDistance: number;
  };
  fibExtension?: {
    nearestLevel: number;
    nearestPrice: number;
    priceDistance: number;
  };
  stdDev?: {
    value: number;
    percentOfPrice: number;
  };
  pitchfork?: {
    /** Where price sits relative to the 5 pitchfork lines */
    priceVsMedian: "above" | "below" | "near";
    priceVsUpperTine: "above" | "below" | "near";
    priceVsLowerTine: "above" | "below" | "near";
    priceVsUpperWarning: "above" | "below" | "near";
    priceVsLowerWarning: "above" | "below" | "near";
    /** Distance from price to each line as % of tine-to-tine width */
    distFromMedianPct: number;
    /** Qualitative position within the fork geometry */
    position: "above-upper-warning" | "upper-warning-zone" | "upper-half" | "near-median" | "lower-half" | "lower-warning-zone" | "below-lower-warning";
    /** Whether price appears to be reverting toward median */
    reverting: boolean;
    /** Anchor metadata */
    anchors: { a1: number; a2: number; a3: number };
    /** Median line slope direction */
    medianSlope: "rising" | "falling" | "flat";
  };
}

/** The AI-generated setup interpretation */
export interface SetupAnalysis {
  bias: "Bullish" | "Bearish" | "Neutral" | "Mixed";
  regime: string;
  bullishEvidence: string[];
  bearishEvidence: string[];
  conflicts: string[];
  confirmsNext: string;
  invalidatesNext: string;
  generatedAt: string;
  source: "gemini" | "fallback";
  /** Which indicators were analysed */
  indicatorsUsed: string[];
  /** Chart context this was generated for */
  context: { symbol: string; range: string; interval: string; chartType: string };
  /** Whether macro regime context was included in the analysis */
  hasMacroContext: boolean;
}

// ─── Macro Market View ───────────────────────────────────────────────────────

export type MarketRegime = "Risk-On" | "Cautious" | "Risk-Off" | "Mixed";

/** A single macro instrument reading (treasury yield, VIX, DXY, oil, etc.) */
export interface MacroDataPoint {
  symbol: string;
  name: string;
  value: number;
  change: number;
  changePercent: number;
}

// ── Derived regime signals ──────────────────────────────────────────────────

/**
 * Policy-path context derived from rates structure.
 * Designed so FedWatch / FRED can be plugged in later as a better source.
 */
export interface PolicyContext {
  /** 13-week T-bill rate — closest proxy for current Fed funds rate */
  shortRate: MacroDataPoint | null;
  /** Market-implied bias from rates structure */
  bias: "Dovish" | "Neutral" | "Hawkish";
  /** Human-readable basis for the bias determination */
  basisDescription: string;
  /** Placeholder for future FedWatch integration (implied fed funds rate) */
  fedFundsImplied: number | null;
  /** Placeholder for future "N cuts/hikes priced in" string */
  cutsHikesExpected: string | null;
  /** How this was derived — transparency for UI */
  source: "rates-derived" | "fedwatch" | "unavailable";
}

/**
 * Breadth reading with explicit source labeling.
 * Distinguishes between a narrow watchlist proxy and a broader market signal.
 */
export interface BreadthReading {
  /** Source type so UI labels appropriately (never claims market-wide if it isn't) */
  source: "watchlist-proxy" | "etf-divergence" | "market-wide";
  /** Watchlist-level advance/decline */
  watchlist: { advancers: number; decliners: number; ratio: number; sampleSize: number } | null;
  /** Equal-weight vs cap-weight divergence: RSP daily % − SPY daily %
   *  Positive = small names outperforming (breadth expanding)
   *  Negative = cap-weight leaders only (breadth narrowing) */
  equalWeightDivergence: number | null;
  /** Qualitative label */
  assessment: "Broad" | "Healthy" | "Narrow" | "Very Narrow" | null;
  /** One-line human-readable explanation */
  description: string;
}

// ── Confidence / transparency ───────────────────────────────────────────────

/** Computed confidence metadata — deterministic, not AI-generated */
export interface ConfidenceMeta {
  level: "High" | "Medium" | "Low";
  /** 0–100 composite score based on input coverage + signal quality */
  score: number;
  /** Specific reasons explaining the confidence level */
  reasons: string[];
  /** Fraction of possible inputs that are available (0–1) */
  inputCoverage: number;
  /** Whether the snapshot data is stale */
  isStale: boolean;
  /** Minutes since the snapshot was built */
  snapshotAgeMinutes: number;
}

/** Categorised input signal for the UI source-transparency strip */
export interface InputSignal {
  category: "Indices" | "Rates" | "Curve" | "Policy" | "Volatility" | "Dollar" | "Oil" | "Breadth" | "Sentiment" | "News";
  status: "live" | "stale" | "proxy" | "derived" | "missing";
  /** Short label shown in the UI */
  label: string;
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

/**
 * Structured macro snapshot — the objective data layer that feeds the
 * bull/bear synthesis. Designed so individual fields can be null when
 * a data source is temporarily unavailable.
 *
 * Structure:
 *   1. Objective market state (instrument readings)
 *   2. Derived regime signals (policy, curve, breadth)
 *   3. Narrative inputs (headlines, movers)
 *   4. Metadata (freshness, confidence, input coverage)
 */
export interface MacroSnapshot {
  // ═══ 1. Objective market state ═════════════════════════════════════════════

  /** Major equity indices */
  indices: MarketIndex[];
  /** 2-Year Treasury yield */
  treasury2Y: MacroDataPoint | null;
  /** 10-Year Treasury yield */
  treasury10Y: MacroDataPoint | null;
  /** 13-week T-bill (short-rate proxy) */
  treasury3M: MacroDataPoint | null;
  /** CBOE Volatility Index */
  vix: MacroDataPoint | null;
  /** US Dollar Index */
  dxy: MacroDataPoint | null;
  /** WTI Crude Oil */
  oil: MacroDataPoint | null;
  /** Fear & Greed reading */
  fearGreed: { score: number; label: string } | null;

  // ═══ 2. Derived regime signals ═════════════════════════════════════════════

  /** 2s10s spread (positive = normal, negative = inverted) */
  yieldCurve2s10s: number | null;
  curveShape: "Steep" | "Normal" | "Flat" | "Inverted" | null;
  /** Policy path context derived from rates or future external source */
  policyPath: PolicyContext;
  /** Breadth with explicit source transparency */
  breadth: BreadthReading;

  // ═══ 3. Narrative inputs ═══════════════════════════════════════════════════

  topMovers: { symbol: string; changePercent: number }[];
  headlines: string[];

  // ═══ 4. Metadata ══════════════════════════════════════════════════════════

  timestamp: string;
  /** Computed confidence for this snapshot */
  confidence: ConfidenceMeta;
  /** Per-category signal status for UI transparency */
  signals: InputSignal[];
  /** Which inputs were successfully populated */
  availableInputs: string[];
  /** Which inputs are still missing or degraded */
  missingInputs: string[];
}

// ── View (synthesised output) ───────────────────────────────────────────────

export interface MacroView {
  bullPoints: string[];
  bearPoints: string[];
  neutralSummary: string;
  /** Actionable items to monitor */
  watchItems: string[];
  regime: MarketRegime;
  /** Deterministically computed confidence — not AI-generated */
  confidence: ConfidenceMeta;
  generatedAt: string;
  source: "gemini" | "fallback";
  /** Human-readable data inputs that fed the synthesis */
  dataSources: string[];
  /** The structured snapshot that produced this view */
  snapshot: MacroSnapshot;
}

// ─── API Response Wrappers ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  cachedAt?: string;
}
