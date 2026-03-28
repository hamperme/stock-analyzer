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

// ─── API Response Wrappers ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  cachedAt?: string;
}
