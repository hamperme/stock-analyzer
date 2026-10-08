// ─── Market Data ──────────────────────────────────────────────────────────────

export type AssetType = "stock" | "crypto";

export interface StockQuote {
  symbol: string;
  assetType?: AssetType;
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

// ─── Model-driven chart drawings ────────────────────────────────────────────

export type ChartDrawingKind =
  | "trendline"
  | "ray"
  | "horizontal"
  | "vertical"
  | "channel"
  | "rectangle"
  | "arrow"
  | "polyline"
  | "label";

export interface ChartDrawingPoint {
  /** ISO timestamp/date matching a candle, or a time close to one. */
  date: string;
  price: number;
}

export interface ChartDrawingStyle {
  color?: string;
  width?: number;
  opacity?: number;
  dash?: string;
  fill?: string;
  fillOpacity?: number;
}

/** Provider-neutral command that any future analysis model can emit. */
export interface ChartDrawing {
  id: string;
  kind: ChartDrawingKind;
  points: ChartDrawingPoint[];
  label?: string;
  style?: ChartDrawingStyle;
  extendLeft?: boolean;
  extendRight?: boolean;
  visible?: boolean;
  createdBy?: "user" | "model";
  metadata?: Record<string, string | number | boolean | null>;
}

// ─── Crypto derivatives market data ───

export interface DerivativesPoint {
  time: number;
  value: number;
}

export interface DerivativesSnapshot {
  symbol: string;
  exchangeSymbol: string;
  markPrice: number;
  indexPrice: number;
  basisPct: number;
  fundingRate: number;
  fundingAnnualizedPct: number;
  nextFundingTime: number;
  openInterest: number;
  openInterestUsd: number;
  openInterestChange24hPct: number | null;
  longAccountPct: number | null;
  shortAccountPct: number | null;
  longShortRatio: number | null;
  takerBuySellRatio: number | null;
  oiHistory: DerivativesPoint[];
  fundingHistory: DerivativesPoint[];
  updatedAt: string;
  source: "binance-usdm";
}

export interface UnusualOption {
  contract: string;
  type: "call" | "put";
  strike: number;
  expiry: string;
  volume: number;
  openInterest: number;
  volumeOiRatio: number;
  impliedVolatilityPct: number;
}

export interface OptionStrikeProfile {
  strike: number;
  callOpenInterest: number;
  putOpenInterest: number;
  netGamma: number;
}

export interface OptionExpiryAnalytics {
  expiry: string;
  daysToExpiry: number;
  callOpenInterest: number;
  putOpenInterest: number;
  putCallRatio: number;
  maxPain: number | null;
  callWall: number | null;
  putWall: number | null;
  gammaFlipEstimate: number | null;
  strikes: OptionStrikeProfile[];
}

export interface OptionsSnapshot {
  symbol: string;
  underlyingPrice: number;
  iv30Pct: number;
  expectedMove30d: number;
  callOpenInterest: number;
  putOpenInterest: number;
  putCallOiRatio: number;
  callVolume: number;
  putVolume: number;
  putCallVolumeRatio: number;
  gammaExposure: number;
  maxPain: number | null;
  nearestExpiry: string | null;
  unusualContracts: UnusualOption[];
  expiries: OptionExpiryAnalytics[];
  updatedAt: string;
  source: "cboe-delayed";
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
  assetType?: AssetType;
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

export interface WatchlistSearchResult {
  symbol: string;
  assetType: AssetType;
  shortName: string;
  longName: string;
  exchange: string | null;
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

/** Deterministically computed confidence metadata. */
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
  /** Deterministically computed confidence */
  confidence: ConfidenceMeta;
  generatedAt: string;
  source: "rules";
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
