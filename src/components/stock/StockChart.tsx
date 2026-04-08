"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
  Customized,
  Cell,
} from "recharts";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  Activity,
  AlertTriangle,
  BarChart3,
  Layers,
  Settings2,
  MousePointer2,
  RotateCcw,
  Crosshair,
  Sparkles,
  Loader2,
  TrendingUp,
  TrendingDown,
  Eye,
  Minus,
  AlertOctagon,
} from "lucide-react";
import type { ChartDataPoint, SetupAnalysis, SetupAnalysisInput, ActiveIndicatorSnapshot, IndicatorStructuredData, MacroContextPayload } from "@/lib/types";
import {
  calculateBollingerBands,
  calculateStochastic,
  calculateMACD,
  calculateADX,
  calculateRollingStdDev,
  findSwingPoints,
  calculateFibRetracementLevels,
  calculateFibExtensionLevels,
  calculateIchimoku,
} from "@/lib/calculations";

// ─── Range & Interval Options ────────────────────────────────────────────────

const RANGES = [
  { label: "1D", value: "1d" },
  { label: "5D", value: "5d" },
  { label: "1M", value: "1m" },
  { label: "3M", value: "3m" },
  { label: "6M", value: "6m" },
  { label: "1Y", value: "1y" },
  { label: "ALL", value: "all" },
] as const;

const INTERVALS = [
  { label: "1H", value: "1h" },
  { label: "1D", value: "1d" },
  { label: "1W", value: "1w" },
  { label: "1M", value: "1mo" },
] as const;

export type RangeValue = (typeof RANGES)[number]["value"];
export type IntervalValue = (typeof INTERVALS)[number]["value"];
export type ChartType = "line" | "candle";

const CANDLE_BULL = "#22c55e";
const CANDLE_BEAR = "#ef4444";
const CANDLE_DOJI = "#64748b";

// ─── Chart Anchor (reusable for Pitchfork, future manual Fib, etc.) ─────────

export interface ChartAnchor {
  date: string;   // ISO date string — stable key across data recomputation
  price: number;  // price at anchor (close of the selected bar)
}

const MAX_PITCHFORK_ANCHORS = 3;
const ANCHOR_LABELS = ["A1", "A2", "A3"] as const;

// ─── Indicator State ─────────────────────────────────────────────────────────

interface IndicatorState {
  bollinger: boolean;
  stochastic: boolean;
  macd: boolean;
  adx: boolean;
  logScale: boolean;
  fibRetracement: boolean;
  fibExtension: boolean;
  stdDev: boolean;
  ichimoku: boolean;
  pitchfork: boolean;
}

const DEFAULT_INDICATORS: IndicatorState = {
  bollinger: false,
  stochastic: false,
  macd: false,
  adx: false,
  logScale: false,
  fibRetracement: false,
  fibExtension: false,
  stdDev: false,
  ichimoku: false,
  pitchfork: false,
};

// ─── Colors ──────────────────────────────────────────────────────────────────

const MA_COLORS = { ma20: "#f59e0b", ma50: "#3b82f6", ma200: "#8b5cf6" };

const BOLLINGER_COLORS = { upper: "#06b6d4", middle: "#06b6d4", lower: "#06b6d4" };
const STOCH_COLORS = { k: "#f59e0b", d: "#a855f7" };
const MACD_COLORS = { macd: "#3b82f6", signal: "#ef4444", histUp: "#22c55e", histDown: "#ef4444" };
const ADX_COLORS = { adx: "#f59e0b", plusDI: "#22c55e", minusDI: "#ef4444" };
const FIB_RET_COLOR = "#d97706";
const FIB_EXT_COLOR = "#0891b2";
const STDDEV_COLOR = "#a78bfa";
const PITCHFORK_COLOR = "#f472b6";
const ANCHOR_COLOR = "#f472b6";

// ─── Chart layout constants ─────────────────────────────────────────────────
// These mirror the actual margin/axis props passed to ComposedChart + YAxis.
// Keeping them in one place means collision detection and label rendering
// always agree with the real chart geometry.

const CHART_MARGIN = { top: 5, right: 60, bottom: 0, left: 10 } as const;
const Y_AXIS_WIDTH = 56;
const CHART_HEIGHT = 320; // ResponsiveContainer height

/**
 * Derive the actual SVG plot-area rectangle from the container dimensions
 * and the chart layout constants above.  Recharts lays out the plot area as:
 *   plotLeft   = margin.left + yAxisWidth
 *   plotRight  = containerWidth - margin.right
 *   plotTop    = margin.top
 *   plotBottom = containerHeight - margin.bottom
 */
function plotBounds(containerW: number, containerH: number) {
  return {
    left:   CHART_MARGIN.left + Y_AXIS_WIDTH,
    right:  containerW - CHART_MARGIN.right,
    top:    CHART_MARGIN.top,
    bottom: containerH - CHART_MARGIN.bottom,
    width:  containerW - CHART_MARGIN.left - Y_AXIS_WIDTH - CHART_MARGIN.right,
    height: containerH - CHART_MARGIN.top - CHART_MARGIN.bottom,
  };
}

// ─── Fib label layout helpers ───────────────────────────────────────────────

/** Priority tiers: lower number = higher priority (shown first when crowded) */
const FIB_RET_PRIORITY: Record<number, number> = {
  0: 1, 1: 1, 0.618: 1, 0.5: 2, 0.382: 2, 0.236: 3, 0.786: 3,
};
const FIB_EXT_PRIORITY: Record<number, number> = {
  1.618: 1, 1.272: 1, 2.618: 1, 1: 2, 0.618: 2, 2: 3, 3.618: 3,
};
const FIB_LABEL_MIN_GAP_PX = 14; // min vertical pixels between label centers
const FIB_LABEL_INSET = 6;       // px inset from the plot-area edge

interface ResolvedFibLabel {
  price: number;
  ratio: number;
  label: string; // e.g. "61.8%"
  priority: number;
  color: string;
  side: "left" | "right"; // label placement side
  showPrice: boolean; // whether to show $price alongside ratio
  visible: boolean;
}

/**
 * Resolve which Fib labels to show and in what format.
 * Operates in pixel-space for collision detection.
 *
 * @param plotH  Real plot-area height in pixels (from plotBounds)
 * @param plotTop Real plot-area top offset in pixels
 */
function resolveFibLabels(
  retLevels: { ratio: number; label: string; price: number }[],
  extLevels: { ratio: number; label: string; price: number }[],
  domainMin: number,
  domainMax: number,
  plotH: number,
  plotTop: number,
): ResolvedFibLabel[] {
  // Linear price → pixel-Y mapper using actual plot-area geometry.
  // In SVG, Y increases downward, so higher prices map to lower Y values.
  const domainSpan = domainMax - domainMin;
  const yScale = (price: number): number => {
    if (domainSpan <= 0) return plotTop + plotH / 2;
    return plotTop + (1 - (price - domainMin) / domainSpan) * plotH;
  };

  // Build candidates
  const candidates: ResolvedFibLabel[] = [];

  for (const lv of retLevels) {
    candidates.push({
      price: lv.price,
      ratio: lv.ratio,
      label: lv.label,
      priority: FIB_RET_PRIORITY[lv.ratio] ?? 3,
      color: FIB_RET_COLOR,
      side: "right",
      showPrice: true,
      visible: true,
    });
  }
  for (const lv of extLevels) {
    candidates.push({
      price: lv.price,
      ratio: lv.ratio,
      label: lv.label,
      priority: FIB_EXT_PRIORITY[lv.ratio] ?? 3,
      color: FIB_EXT_COLOR,
      side: "left",
      showPrice: true,
      visible: true,
    });
  }

  if (candidates.length === 0) return candidates;

  // Sort by priority (best first), then by price desc for stable ordering
  candidates.sort((a, b) => a.priority - b.priority || b.price - a.price);

  // Greedily assign visibility — first-fit by pixel Y position
  const placedLeft: number[] = [];
  const placedRight: number[] = [];

  for (const c of candidates) {
    const py = yScale(c.price);
    if (isNaN(py)) { c.visible = false; continue; }

    // Clip labels that would fall outside the plot area (with small tolerance)
    if (py < plotTop - 4 || py > plotTop + plotH + 4) { c.visible = false; continue; }

    const sameSide = c.side === "left" ? placedLeft : placedRight;
    const tooClose = sameSide.some((placedY) => Math.abs(py - placedY) < FIB_LABEL_MIN_GAP_PX);

    if (tooClose) {
      // Try compact mode (ratio only) — needs less space
      const COMPACT_GAP = FIB_LABEL_MIN_GAP_PX * 0.7;
      const stillTooClose = sameSide.some((placedY) => Math.abs(py - placedY) < COMPACT_GAP);
      if (stillTooClose) {
        c.visible = false;
      } else {
        c.showPrice = false; // compact: ratio only
        sameSide.push(py);
      }
    } else {
      sameSide.push(py);
    }
  }

  return candidates;
}

/**
 * Custom SVG label for Fib reference lines.
 *
 * Recharts passes `viewBox` with the real SVG geometry of the ReferenceLine:
 *   viewBox.x     = plot-area left edge (px)
 *   viewBox.y     = actual Y coordinate of this level (px)
 *   viewBox.width = plot-area width (px)
 *
 * We use these to position labels relative to the actual plot bounds,
 * eliminating any hardcoded x offsets.
 */
function FibLabel({
  viewBox,
  text,
  color,
  side,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewBox?: any;
  text: string;
  color: string;
  side: "left" | "right";
}) {
  if (!viewBox) return null;

  const plotX     = viewBox.x     ?? 0;   // left edge of plot area
  const plotW     = viewBox.width ?? 0;   // plot area width
  const y         = viewBox.y     ?? 0;   // real Y of the Fib level

  // Position labels just inside the plot-area edges
  const x = side === "right"
    ? plotX + plotW - FIB_LABEL_INSET   // right-aligned inside plot area
    : plotX + FIB_LABEL_INSET;          // left-aligned inside plot area
  const anchor = side === "right" ? "end" : "start";

  // Approximate pill width from character count (monospace ~5.4px per char at 9px font)
  const charW = 5.4;
  const pillW = text.length * charW + 8;
  const pillX = side === "right" ? x - pillW + 2 : x - 4;

  return (
    <g>
      {/* Semi-transparent background pill for contrast */}
      <rect
        x={pillX}
        y={y - 7}
        width={pillW}
        height={14}
        rx={2}
        fill="#111118"
        fillOpacity={0.75}
      />
      <text
        x={x}
        y={y + 3}
        textAnchor={anchor}
        fill={color}
        fontSize={9}
        fontWeight={600}
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        opacity={0.85}
      >
        {text}
      </text>
    </g>
  );
}

const ICHIMOKU_COLORS = {
  tenkan: "#e879f9",
  kijun: "#38bdf8",
  senkouA: "#4ade80",
  senkouB: "#f87171",
  chikou: "#94a3b8",
};

// ─── Minimum data requirements ───────────────────────────────────────────────

const MIN_BARS: Record<string, number> = {
  bollinger: 20,
  stochastic: 16,
  macd: 35,
  adx: 28,
  fibRetracement: 5,
  fibExtension: 5,
  stdDev: 21,
  ichimoku: 52,
};

// ─── Clutter thresholds ──────────────────────────────────────────────────────

const OVERLAY_WARN_THRESHOLD = 3;  // warn when ≥ 3 overlay types active
const PANE_WARN_THRESHOLD = 3;     // warn when ≥ 3 oscillator panes active

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  data: ChartDataPoint[];
  symbol?: string;
  activeRange?: RangeValue;
  activeInterval?: IntervalValue;
  intradaySupported?: boolean;
  onRangeChange?: (range: RangeValue) => void;
  onIntervalChange?: (interval: IntervalValue) => void;
  loading?: boolean;
  error?: string | null;
}

// ─── Enriched data point ─────────────────────────────────────────────────────

interface EnrichedPoint extends ChartDataPoint {
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  stochK?: number;
  stochD?: number;
  macdLine?: number;
  macdSignal?: number;
  macdHist?: number;
  adxVal?: number;
  plusDI?: number;
  minusDI?: number;
  rollingStdDev?: number;
  tenkan?: number;
  kijun?: number;
  senkouA?: number;
  senkouB?: number;
  chikou?: number;
  _ichimokuFuture?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════════

/** Compact toggle pill for indicator panel */
const TogglePill = React.memo(function TogglePill({
  active,
  onClick,
  disabled,
  children,
  color,
  title,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  color?: string;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? (disabled ? "Not enough data" : undefined)}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all border ${
        disabled
          ? "cursor-not-allowed border-surface-border/20 text-neutral/25 bg-transparent"
          : active
          ? "border-transparent text-white shadow-sm"
          : "border-surface-border/50 text-neutral hover:border-slate-500 hover:text-slate-200 bg-transparent"
      }`}
      style={active && !disabled ? { backgroundColor: color ?? "#3b82f6", borderColor: "transparent" } : undefined}
    >
      {active && !disabled && <span className="h-1.5 w-1.5 rounded-full bg-white/70" />}
      {children}
    </button>
  );
});

/** Consistent insufficient-data placeholder for oscillator panes */
function InsufficientNotice({ name, needed, have }: { name: string; needed: number; have: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-neutral/50">
      <BarChart3 className="h-5 w-5 opacity-30" />
      <p className="text-[11px]">
        <span className="font-medium">{name}</span> requires {needed}+ bars
      </p>
      <p className="text-[10px] text-neutral/30">{have} bar{have !== 1 ? "s" : ""} available</p>
    </div>
  );
}

/** Clutter warning banner */
function ClutterWarning({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-amber-500/8 border border-amber-500/20 px-3 py-1.5 text-[10px] text-amber-400/80">
      <AlertTriangle className="h-3 w-3 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** Legend swatch */
function Swatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-block w-4 rounded-sm ${dashed ? "h-px border-t border-dashed" : "h-[5px]"}`}
        style={dashed ? { borderColor: color } : { backgroundColor: color }}
      />
      <span className="text-neutral/70">{label}</span>
    </span>
  );
}

// ─── Tooltips ────────────────────────────────────────────────────────────────

const TOOLTIP_HIDDEN_KEYS = new Set(["bbFill", "senkouA", "senkouB"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PriceTooltip({ active, payload, label, isCandle }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as EnrichedPoint | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = payload.filter((e: any) =>
    e.value !== undefined && e.value !== null && !TOOLTIP_HIDDEN_KEYS.has(e.dataKey)
  );
  if (!items.length && !isCandle) return null;

  return (
    <div className="rounded-lg border border-surface-border bg-surface/95 backdrop-blur-sm p-2.5 shadow-xl text-xs z-50 max-w-[220px]">
      <p className="mb-1.5 font-semibold text-slate-200 text-[11px]">
        {label ? format(parseISO(label), "MMM d, yyyy") : ""}
      </p>

      {/* OHLC row in candle mode */}
      {isCandle && point && point.close > 0 && (
        <div className="mb-1.5 grid grid-cols-4 gap-x-2 text-[10px] font-mono tabular-nums">
          <span className="text-neutral/50">O <span className="text-slate-300">${point.open.toFixed(2)}</span></span>
          <span className="text-neutral/50">H <span className="text-slate-300">${point.high.toFixed(2)}</span></span>
          <span className="text-neutral/50">L <span className="text-slate-300">${point.low.toFixed(2)}</span></span>
          <span className="text-neutral/50">C <span className={point.close >= point.open ? "text-emerald-400" : "text-red-400"}>${point.close.toFixed(2)}</span></span>
        </div>
      )}

      {/* Indicator values */}
      {items
        .filter((e: { dataKey: string }) => !(isCandle && e.dataKey === "close"))
        .slice(0, 8)
        .map((entry: { name: string; value: number; color: string; dataKey: string }) => (
        <p key={entry.dataKey} style={{ color: entry.color }} className="flex justify-between gap-4 leading-relaxed">
          <span className="capitalize truncate">{entry.name}</span>
          <span className="font-mono font-semibold tabular-nums whitespace-nowrap">
            {entry.name === "volume"
              ? (entry.value / 1_000_000).toFixed(1) + "M"
              : "$" + entry.value?.toFixed(2)}
          </span>
        </p>
      ))}
      {items.length > 8 && (
        <p className="text-[9px] text-neutral/40 mt-1">+{items.length - 8} more</p>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OscTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = payload.filter((e: any) => e.value !== undefined && e.value !== null);
  return (
    <div className="rounded-lg border border-surface-border bg-surface/95 backdrop-blur-sm p-2 shadow-xl text-[10px] z-50">
      <p className="mb-1 font-semibold text-slate-300">
        {label ? format(parseISO(label), "MMM d") : ""}
      </p>
      {items.map((entry: { name: string; value: number; color: string; dataKey: string }) => (
        <p key={entry.dataKey} style={{ color: entry.color }} className="flex justify-between gap-3 leading-relaxed">
          <span>{entry.name}</span>
          <span className="font-mono font-semibold tabular-nums">
            {entry.value?.toFixed(2)}{unit ?? ""}
          </span>
        </p>
      ))}
    </div>
  );
}

function formatXAxis(dateStr: string, dataLen: number) {
  try {
    const d = parseISO(dateStr);
    return dataLen > 200 ? format(d, "MMM yy") : format(d, "MMM d");
  } catch {
    return dateStr;
  }
}

// ─── Oscillator pane wrapper ─────────────────────────────────────────────────

function OscPane({
  title,
  subtitle,
  accentColor,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  accentColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 rounded-lg border border-surface-border/30 bg-surface-elevated/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-border/20">
        <span className="h-3 w-0.5 rounded-full" style={{ backgroundColor: accentColor }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral/60">{title}</span>
        {subtitle && <span className="text-[10px] font-normal normal-case">{subtitle}</span>}
      </div>
      <div className="p-1.5">{children}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

export function StockChart({
  data,
  symbol,
  activeRange = "6m",
  activeInterval = "1d",
  intradaySupported = false,
  onRangeChange,
  onIntervalChange,
  loading,
  error,
}: Props) {
  const [localRange, setLocalRange] = useState<RangeValue>(activeRange);
  const [localInterval, setLocalInterval] = useState<IntervalValue>(activeInterval);
  const [indicators, setIndicators] = useState<IndicatorState>(DEFAULT_INDICATORS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [chartType, setChartType] = useState<ChartType>("line");
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: CHART_HEIGHT });

  // Track real container dimensions for Fib label layout
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) {
        setContainerSize({ w: rect.width, h: rect.height || CHART_HEIGHT });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ─── Anchor selection state ──────────────────────────────────────────────
  const [anchorMode, setAnchorMode] = useState(false);
  const [anchors, setAnchors] = useState<ChartAnchor[]>([]);

  // ─── Setup analysis state ──────────────────────────────────────────────
  const [setupAnalysis, setSetupAnalysis] = useState<SetupAnalysis | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const range = onRangeChange ? activeRange : localRange;
  const interval = onIntervalChange ? activeInterval : localInterval;

  const handleRange = useCallback((r: RangeValue) => { setLocalRange(r); onRangeChange?.(r); }, [onRangeChange]);
  const handleInterval = useCallback((iv: IntervalValue) => { setLocalInterval(iv); onIntervalChange?.(iv); }, [onIntervalChange]);
  const toggle = useCallback((key: keyof IndicatorState) => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Auto-exit anchor mode once all anchors placed
  useEffect(() => {
    if (anchors.length >= MAX_PITCHFORK_ANCHORS) setAnchorMode(false);
  }, [anchors.length]);

  // Clear anchors when data changes (range/interval switch invalidates points)
  const dataFingerprint = data.length > 0 ? `${data[0]?.date}-${data[data.length - 1]?.date}-${data.length}` : "";
  useEffect(() => {
    setAnchors([]);
    setAnchorMode(false);
    setIndicators((prev) => prev.pitchfork ? { ...prev, pitchfork: false } : prev);
  }, [dataFingerprint]);

  const clearAnchors = useCallback(() => {
    setAnchors([]);
    setAnchorMode(false);
    setIndicators((prev) => prev.pitchfork ? { ...prev, pitchfork: false } : prev);
  }, []);

  const handleChartClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state: any) => {
      if (!anchorMode || anchors.length >= MAX_PITCHFORK_ANCHORS) return;
      const payload = state?.activePayload?.[0]?.payload;
      if (!payload?.date || payload._ichimokuFuture) return;
      // Avoid duplicate anchors on the same bar
      if (anchors.some((a) => a.date === payload.date)) return;
      setAnchors((prev) => [...prev, { date: payload.date, price: payload.close }]);
    },
    [anchorMode, anchors],
  );

  // ─── Analyze Current Setup ──────────────────────────────────────────────
  const analyzeSetup = useCallback(async () => {
    if (!symbol || !data.length) return;
    setSetupLoading(true);
    setSetupError(null);

    const lastBar = data[data.length - 1];
    const price = lastBar.close;
    const closes = data.map((d) => d.close);
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const n = data.length;

    const snaps: ActiveIndicatorSnapshot[] = [];

    // ── Fetch structured macro context (non-blocking — proceeds without it) ──
    let macroContext: MacroContextPayload | null = null;
    try {
      const macroRes = await fetch("/api/macro-view");
      const macroJson = await macroRes.json();
      if (macroJson.data) {
        const mv = macroJson.data;
        const snap = mv.snapshot;
        const vixVal = snap?.vix?.value ?? null;
        macroContext = {
          regime: mv.regime,
          confidence: mv.confidence?.level ?? "Low",
          confidenceScore: mv.confidence?.score ?? 0,
          isStale: mv.confidence?.isStale ?? false,
          bullDrivers: (mv.bullPoints ?? []).slice(0, 3),
          bearDrivers: (mv.bearPoints ?? []).slice(0, 3),
          watchNext: (mv.watchItems ?? []).slice(0, 2),
          summary: mv.neutralSummary ?? "",
          policyBias: snap?.policyPath?.bias ?? null,
          volatility: vixVal != null ? {
            vix: vixVal,
            regime: vixVal >= 30 ? "extreme" as const : vixVal >= 25 ? "high" as const : vixVal >= 18 ? "elevated" as const : "low" as const,
          } : null,
          breadth: snap?.breadth?.assessment ?? null,
          fearGreed: snap?.fearGreed ?? null,
        };
      }
    } catch {
      // macro context is optional — proceed without it
    }

    if (indicators.bollinger && n >= 20) {
      const { calculateBollingerBands: calcBB } = await import("@/lib/calculations");
      const bb = calcBB(closes);
      const last = bb[bb.length - 1];
      if (last?.upper != null && last.middle != null && last.lower != null) {
        const bw = last.upper - last.lower;
        const pctB = bw > 0 ? (price - last.lower) / bw * 100 : 50;
        const structured: IndicatorStructuredData = {
          bollinger: { upper: last.upper, middle: last.middle, lower: last.lower, bandwidth: bw, percentB: Math.round(pctB) },
        };
        snaps.push({ name: "Bollinger Bands", state: `Upper: ${last.upper.toFixed(2)}, Mid: ${last.middle.toFixed(2)}, Lower: ${last.lower.toFixed(2)} — price at ${pctB.toFixed(0)}% of band width`, structured });
      }
    }

    if (indicators.stochastic && n >= 14) {
      const { calculateStochastic: calcSt } = await import("@/lib/calculations");
      const st = calcSt(highs, lows, closes);
      const last = st[st.length - 1];
      if (last?.k != null && last.d != null) {
        const zone: "overbought" | "oversold" | "neutral" = last.k > 80 ? "overbought" : last.k < 20 ? "oversold" : "neutral";
        const crossover: "bullish" | "bearish" | "none" = last.k > last.d ? "bullish" : last.k < last.d ? "bearish" : "none";
        const zoneLabel = zone === "neutral" ? "neutral zone" : zone;
        const crossLabel = crossover === "bullish" ? "K above D (bullish)" : crossover === "bearish" ? "K below D (bearish)" : "converging";
        const structured: IndicatorStructuredData = {
          stochastic: { k: last.k, d: last.d, zone, crossover },
        };
        snaps.push({ name: "Stochastic (14,3)", state: `K: ${last.k.toFixed(1)}, D: ${last.d.toFixed(1)} — ${zoneLabel}, ${crossLabel}`, structured });
      }
    }

    if (indicators.macd && n >= 26) {
      const { calculateMACD: calcM } = await import("@/lib/calculations");
      const m = calcM(closes);
      const last = m[m.length - 1];
      if (last?.macd != null && last.signal != null && last.histogram != null) {
        const histogramSign: "positive" | "negative" | "zero" = last.histogram > 0 ? "positive" : last.histogram < 0 ? "negative" : "zero";
        const crossover: "bullish" | "bearish" | "none" = last.macd > last.signal ? "bullish" : last.macd < last.signal ? "bearish" : "none";
        const crossLabel = crossover === "bullish" ? "MACD above signal (bullish)" : "MACD below signal (bearish)";
        const structured: IndicatorStructuredData = {
          macd: { macd: last.macd, signal: last.signal, histogram: last.histogram, histogramSign, crossover },
        };
        snaps.push({ name: "MACD (12,26,9)", state: `MACD: ${last.macd.toFixed(3)}, Signal: ${last.signal.toFixed(3)}, Histogram: ${last.histogram.toFixed(3)} (${histogramSign}) — ${crossLabel}`, structured });
      }
    }

    if (indicators.adx && n >= 28) {
      const { calculateADX: calcA } = await import("@/lib/calculations");
      const a = calcA(highs, lows, closes);
      const last = a[a.length - 1];
      if (last?.adx != null && last.plusDI != null && last.minusDI != null) {
        const trendStrength: "strong" | "trending" | "weak" | "none" = last.adx > 40 ? "strong" : last.adx > 25 ? "trending" : last.adx > 20 ? "weak" : "none";
        const direction: "bullish" | "bearish" = last.plusDI > last.minusDI ? "bullish" : "bearish";
        const strengthLabel = trendStrength === "strong" ? "strong trend" : trendStrength === "trending" ? "trending" : trendStrength === "weak" ? "weak trend" : "no trend / range-bound";
        const dirLabel = direction === "bullish" ? "+DI > -DI (bullish directional)" : "-DI > +DI (bearish directional)";
        const structured: IndicatorStructuredData = {
          adx: { adx: last.adx, plusDI: last.plusDI, minusDI: last.minusDI, trendStrength, direction },
        };
        snaps.push({ name: "ADX (14)", state: `ADX: ${last.adx.toFixed(1)}, +DI: ${last.plusDI.toFixed(1)}, -DI: ${last.minusDI.toFixed(1)} — ${strengthLabel}, ${dirLabel}`, structured });
      }
    }

    if (indicators.ichimoku && n >= 52) {
      const { calculateIchimoku: calcI } = await import("@/lib/calculations");
      const ichi = calcI(highs, lows, closes);
      const last = ichi[n - 1];
      if (last) {
        const parts: string[] = [];
        let tenkanAboveKijun: boolean | null = null;
        let priceVsCloud: "above" | "below" | "inside" = "inside";
        let cloudColor: "green" | "red" | null = null;

        if (last.tenkan !== undefined && last.kijun !== undefined) {
          tenkanAboveKijun = last.tenkan > last.kijun;
          parts.push(tenkanAboveKijun ? "Tenkan above Kijun (bullish)" : "Tenkan below Kijun (bearish)");
        }
        if (last.senkouA !== undefined && last.senkouB !== undefined) {
          const cloudTop = Math.max(last.senkouA, last.senkouB);
          const cloudBot = Math.min(last.senkouA, last.senkouB);
          if (price > cloudTop) { priceVsCloud = "above"; parts.push("price above cloud (bullish)"); }
          else if (price < cloudBot) { priceVsCloud = "below"; parts.push("price below cloud (bearish)"); }
          else { priceVsCloud = "inside"; parts.push("price inside cloud (indecisive)"); }
          cloudColor = last.senkouA > last.senkouB ? "green" : "red";
          parts.push(cloudColor === "green" ? "green cloud" : "red cloud");
        }
        const structured: IndicatorStructuredData = {
          ichimoku: { tenkanAboveKijun, priceVsCloud, cloudColor },
        };
        snaps.push({ name: "Ichimoku Cloud", state: parts.join(", "), structured });
      }
    }

    if (indicators.fibRetracement && n >= 20) {
      const { findSwingPoints, calculateFibRetracementLevels } = await import("@/lib/calculations");
      const swing = findSwingPoints(highs, lows);
      const highFirst = swing.swingHighIdx < swing.swingLowIdx;
      const levels = calculateFibRetracementLevels(swing.swingHigh, swing.swingLow, highFirst);
      let nearest = levels[0];
      for (const l of levels) {
        if (Math.abs(price - l.price) < Math.abs(price - nearest.price)) nearest = l;
      }
      const structured: IndicatorStructuredData = {
        fibRetracement: { nearestLevel: nearest.ratio, nearestPrice: nearest.price, priceDistance: price - nearest.price },
      };
      snaps.push({ name: "Fib Retracement", state: `Nearest level: ${(nearest.ratio * 100).toFixed(1)}% at $${nearest.price.toFixed(2)} (price: $${price.toFixed(2)})`, structured });
    }

    if (indicators.fibExtension && n >= 20) {
      const { findSwingPoints, calculateFibExtensionLevels } = await import("@/lib/calculations");
      const swing = findSwingPoints(highs, lows);
      const highFirst = swing.swingHighIdx < swing.swingLowIdx;
      const levels = calculateFibExtensionLevels(swing.swingHigh, swing.swingLow, highFirst);
      let nearest = levels[0];
      for (const l of levels) {
        if (Math.abs(price - l.price) < Math.abs(price - nearest.price)) nearest = l;
      }
      const structured: IndicatorStructuredData = {
        fibExtension: { nearestLevel: nearest.ratio, nearestPrice: nearest.price, priceDistance: price - nearest.price },
      };
      snaps.push({ name: "Fib Extension", state: `Nearest level: ${(nearest.ratio * 100).toFixed(1)}% at $${nearest.price.toFixed(2)} (price: $${price.toFixed(2)})`, structured });
    }

    if (indicators.stdDev && n >= 20) {
      const { calculateRollingStdDev } = await import("@/lib/calculations");
      const sd = calculateRollingStdDev(closes);
      const last = sd[sd.length - 1];
      if (last && last.stdDev !== undefined) {
        const pctOfPrice = price > 0 ? last.stdDev / price * 100 : 0;
        const structured: IndicatorStructuredData = {
          stdDev: { value: last.stdDev, percentOfPrice: Math.round(pctOfPrice * 100) / 100 },
        };
        snaps.push({ name: "Rolling Std Dev", state: `StdDev: ${last.stdDev.toFixed(3)} (${pctOfPrice.toFixed(2)}% of price)`, structured });
      }
    }

    if (indicators.pitchfork && anchors.length === MAX_PITCHFORK_ANCHORS) {
      // ── Compute Pitchfork geometry in price space ──
      // Andrews' Pitchfork: A1 = pivot, A2 = upper anchor, A3 = lower anchor
      // Median line runs from A1 through midpoint(A2, A3).
      // Tines are parallel to median through A2/A3.
      // Warning lines at 2× perpendicular offset from median.
      const [a1, a2, a3] = anchors;
      const a1Idx = data.findIndex(d => d.date === a1.date);
      const a2Idx = data.findIndex(d => d.date === a2.date);
      const a3Idx = data.findIndex(d => d.date === a3.date);
      const lastIdx = n - 1;

      if (a1Idx >= 0 && a2Idx >= 0 && a3Idx >= 0 && lastIdx > a1Idx) {
        // Midpoint of A2-A3
        const midPrice = (a2.price + a3.price) / 2;
        const midIdx = (a2Idx + a3Idx) / 2;

        // Median line: from (a1Idx, a1.price) through (midIdx, midPrice)
        const medDIdx = midIdx - a1Idx;
        const medDPrice = midPrice - a1.price;

        if (Math.abs(medDIdx) > 0) {
          const slope = medDPrice / medDIdx; // price per bar

          // Price on median at the last bar
          const medianAtLast = a1.price + slope * (lastIdx - a1Idx);

          // Upper tine passes through A2, parallel to median
          const upperTineAtLast = a2.price + slope * (lastIdx - a2Idx);

          // Lower tine passes through A3, parallel to median
          const lowerTineAtLast = a3.price + slope * (lastIdx - a3Idx);

          // Perpendicular offset from median to tines (in price, at their anchor x)
          const offsetUpper = a2.price - (a1.price + slope * (a2Idx - a1Idx));
          const offsetLower = a3.price - (a1.price + slope * (a3Idx - a1Idx));

          // Warning lines at 2× offset
          const upperWarnAtLast = medianAtLast + 2 * offsetUpper;
          const lowerWarnAtLast = medianAtLast + 2 * offsetLower;

          // Tine-to-tine width at last bar
          const tineWidth = Math.abs(upperTineAtLast - lowerTineAtLast);
          const distFromMedian = price - medianAtLast;
          const distFromMedianPct = tineWidth > 0 ? Math.round((distFromMedian / (tineWidth / 2)) * 100) : 0;

          const nearThreshold = tineWidth > 0 ? tineWidth * 0.08 : price * 0.005;
          const classify = (p: number, line: number): "above" | "below" | "near" =>
            Math.abs(p - line) < nearThreshold ? "near" : p > line ? "above" : "below";

          const priceVsMedian = classify(price, medianAtLast);
          const priceVsUpperTine = classify(price, upperTineAtLast);
          const priceVsLowerTine = classify(price, lowerTineAtLast);
          const priceVsUpperWarning = classify(price, upperWarnAtLast);
          const priceVsLowerWarning = classify(price, lowerWarnAtLast);

          // Qualitative position
          let position: NonNullable<IndicatorStructuredData["pitchfork"]>["position"];
          if (price > upperWarnAtLast + nearThreshold) position = "above-upper-warning";
          else if (priceVsUpperWarning === "near" || (price > upperTineAtLast && price <= upperWarnAtLast + nearThreshold)) position = "upper-warning-zone";
          else if (price > medianAtLast + nearThreshold && price <= upperTineAtLast + nearThreshold) position = "upper-half";
          else if (priceVsMedian === "near") position = "near-median";
          else if (price < medianAtLast - nearThreshold && price >= lowerTineAtLast - nearThreshold) position = "lower-half";
          else if (priceVsLowerWarning === "near" || (price < lowerTineAtLast && price >= lowerWarnAtLast - nearThreshold)) position = "lower-warning-zone";
          else position = "below-lower-warning";

          // Detect mean-reversion: price was further from median 3 bars ago than now
          let reverting = false;
          if (n >= 4) {
            const prevIdx = lastIdx - 3;
            const medianAtPrev = a1.price + slope * (prevIdx - a1Idx);
            const prevDist = Math.abs(data[prevIdx].close - medianAtPrev);
            reverting = prevDist > Math.abs(distFromMedian) && Math.abs(distFromMedian) > nearThreshold * 0.5;
          }

          const medianSlope: "rising" | "falling" | "flat" = slope > 0.001 * price ? "rising" : slope < -0.001 * price ? "falling" : "flat";

          // Build state string
          const posLabel = position.replace(/-/g, " ");
          const slopeLabel = medianSlope === "rising" ? "rising median" : medianSlope === "falling" ? "falling median" : "flat median";
          const revertLabel = reverting ? ", reverting toward median" : "";
          const stateStr = `Price in ${posLabel} (${distFromMedianPct > 0 ? "+" : ""}${distFromMedianPct}% from median), ${slopeLabel}${revertLabel}. Anchors: A1=$${a1.price.toFixed(2)}, A2=$${a2.price.toFixed(2)}, A3=$${a3.price.toFixed(2)}`;

          const structured: IndicatorStructuredData = {
            pitchfork: {
              priceVsMedian,
              priceVsUpperTine,
              priceVsLowerTine,
              priceVsUpperWarning,
              priceVsLowerWarning,
              distFromMedianPct,
              position,
              reverting,
              anchors: { a1: a1.price, a2: a2.price, a3: a3.price },
              medianSlope,
            },
          };
          snaps.push({ name: "Andrews' Pitchfork", state: stateStr, structured });
        }
      } else {
        // Anchors don't map to data — just pass basic info
        snaps.push({ name: "Andrews' Pitchfork", state: `3-anchor pitchfork active (${anchors.map((a, i) => `A${i+1}: $${a.price.toFixed(2)}`).join(", ")})` });
      }
    }

    // MA context (always available)
    if (n >= 20) {
      const ma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;
      const ma50 = n >= 50 ? closes.slice(-50).reduce((s, v) => s + v, 0) / 50 : null;
      const ma200 = n >= 200 ? closes.slice(-200).reduce((s, v) => s + v, 0) / 200 : null;
      const parts = [`MA20: $${ma20.toFixed(2)}`];
      if (ma50) parts.push(`MA50: $${ma50.toFixed(2)}`);
      if (ma200) parts.push(`MA200: $${ma200.toFixed(2)}`);
      const alignment: "bullish" | "bearish" | "mixed" = ma50 && ma200
        ? (ma20 > ma50 && ma50 > ma200 ? "bullish" : ma20 < ma50 && ma50 < ma200 ? "bearish" : "mixed")
        : "mixed";
      const alignmentLabel = alignment === "bullish" ? "bullish alignment" : alignment === "bearish" ? "bearish alignment" : "mixed alignment";
      const structured: IndicatorStructuredData = {
        movingAverages: { ma20, ma50, ma200, alignment },
      };
      snaps.push({ name: "Moving Averages", state: `${parts.join(", ")} — price $${price.toFixed(2)} ${alignmentLabel}`, structured });
    }

    const input: SetupAnalysisInput = {
      symbol,
      price,
      range,
      interval,
      chartType,
      activeIndicators: snaps,
      macroContext,
    };

    try {
      const res = await fetch(`/api/stock/${symbol}/setup-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setSetupAnalysis(json.data);
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : "Failed to analyze setup");
    } finally {
      setSetupLoading(false);
    }
  }, [symbol, data, indicators, anchors, range, interval, chartType]);

  // Clear setup analysis when indicators or range change
  useEffect(() => {
    setSetupAnalysis(null);
    setSetupError(null);
  }, [indicators, range, interval, chartType]);

  // ─── Derived counts ─────────────────────────────────────────────────────
  const overlayCount = useMemo(() =>
    [indicators.bollinger, indicators.fibRetracement, indicators.fibExtension, indicators.ichimoku].filter(Boolean).length,
    [indicators.bollinger, indicators.fibRetracement, indicators.fibExtension, indicators.ichimoku]
  );
  const paneCount = useMemo(() =>
    [indicators.stochastic, indicators.macd, indicators.adx, indicators.stdDev].filter(Boolean).length,
    [indicators.stochastic, indicators.macd, indicators.adx, indicators.stdDev]
  );
  const activeCount = useMemo(() => Object.values(indicators).filter(Boolean).length, [indicators]);

  // ─── Compute enriched data ──────────────────────────────────────────────
  const enriched = useMemo<EnrichedPoint[]>(() => {
    if (!data.length) return [];

    const closes = data.map((d) => d.close);
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);

    const bb = indicators.bollinger ? calculateBollingerBands(closes) : null;
    const stoch = indicators.stochastic ? calculateStochastic(highs, lows, closes) : null;
    const macd = indicators.macd ? calculateMACD(closes) : null;
    const adx = indicators.adx ? calculateADX(highs, lows, closes) : null;
    const sd = indicators.stdDev ? calculateRollingStdDev(closes) : null;
    const ichi = indicators.ichimoku && data.length >= MIN_BARS.ichimoku
      ? calculateIchimoku(highs, lows, closes) : null;

    const result: EnrichedPoint[] = data.map((point, i) => {
      const e: EnrichedPoint = { ...point };
      if (bb) { e.bbUpper = bb[i].upper; e.bbMiddle = bb[i].middle; e.bbLower = bb[i].lower; }
      if (stoch) { e.stochK = stoch[i].k; e.stochD = stoch[i].d; }
      if (macd) { e.macdLine = macd[i].macd; e.macdSignal = macd[i].signal; e.macdHist = macd[i].histogram; }
      if (adx) { e.adxVal = adx[i].adx; e.plusDI = adx[i].plusDI; e.minusDI = adx[i].minusDI; }
      if (sd) { e.rollingStdDev = sd[i].stdDev; }
      if (ichi) {
        e.tenkan = ichi[i].tenkan; e.kijun = ichi[i].kijun;
        e.senkouA = ichi[i].senkouA; e.senkouB = ichi[i].senkouB;
        e.chikou = ichi[i].chikou;
      }
      return e;
    });

    // Future-projected Ichimoku cloud
    if (ichi) {
      const lastDate = data[data.length - 1]?.date;
      for (let f = 0; f < 26; f++) {
        const idx = data.length + f;
        if (idx >= ichi.length) break;
        const pt = ichi[idx];
        if (pt.senkouA === undefined && pt.senkouB === undefined) continue;
        const futureDate = lastDate
          ? (() => { const d = new Date(lastDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + f + 1); return d.toISOString().split("T")[0]; })()
          : `future-${f}`;
        result.push({
          date: futureDate, open: 0, high: 0, low: 0, close: 0, volume: 0,
          senkouA: pt.senkouA, senkouB: pt.senkouB, _ichimokuFuture: true,
        });
      }
    }
    return result;
  }, [data, indicators.bollinger, indicators.stochastic, indicators.macd, indicators.adx, indicators.stdDev, indicators.ichimoku]);

  // ─── Fibonacci levels ───────────────────────────────────────────────────
  const fibData = useMemo(() => {
    if (data.length < MIN_BARS.fibRetracement) return null;
    if (!indicators.fibRetracement && !indicators.fibExtension) return null;
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const swing = findSwingPoints(highs, lows);
    const highFirst = swing.swingHighIdx < swing.swingLowIdx;
    return {
      retLevels: indicators.fibRetracement ? calculateFibRetracementLevels(swing.swingHigh, swing.swingLow, highFirst) : [],
      extLevels: indicators.fibExtension ? calculateFibExtensionLevels(swing.swingHigh, swing.swingLow, highFirst) : [],
    };
  }, [data, indicators.fibRetracement, indicators.fibExtension]);

  // ─── Price domain ───────────────────────────────────────────────────────
  const { rawMin, rawMax } = useMemo(() => {
    const vals: number[] = [];
    // In candle mode, domain must include highs and lows
    if (chartType === "candle") {
      data.forEach((d) => { if (d.high > 0) vals.push(d.high); if (d.low > 0) vals.push(d.low); });
    } else {
      data.forEach((d) => { if (d.close > 0) vals.push(d.close); });
    }
    if (indicators.bollinger) enriched.forEach((e) => {
      if (e.bbUpper !== undefined) vals.push(e.bbUpper);
      if (e.bbLower !== undefined) vals.push(e.bbLower);
    });
    if (fibData) {
      fibData.retLevels.forEach((l) => vals.push(l.price));
      fibData.extLevels.forEach((l) => vals.push(l.price));
    }
    if (indicators.ichimoku) enriched.forEach((e) => {
      if (e.senkouA !== undefined) vals.push(e.senkouA);
      if (e.senkouB !== undefined) vals.push(e.senkouB);
    });
    return {
      rawMin: vals.length ? Math.min(...vals) * 0.97 : 0,
      rawMax: vals.length ? Math.max(...vals) * 1.03 : 100,
    };
  }, [data, enriched, indicators.bollinger, indicators.ichimoku, fibData, chartType]);

  // ─── Shared axis configs ────────────────────────────────────────────────
  const xAxisProps = useMemo(() => ({
    dataKey: "date" as const,
    tickFormatter: (v: string) => formatXAxis(v, enriched.length),
    tick: { fill: "#64748b", fontSize: 11 },
    axisLine: false, tickLine: false, minTickGap: 40,
  }), [enriched.length]);

  const xAxisHidden = useMemo(() => ({ dataKey: "date" as const, hide: true }), []);
  const oscMargin = { top: 4, right: CHART_MARGIN.right, bottom: 0, left: CHART_MARGIN.left };

  // ─── Fib collision resolution (must run before early returns) ──────────
  const plot = useMemo(() => plotBounds(containerSize.w, containerSize.h), [containerSize]);
  const resolvedFibLabels = useMemo(() => {
    if (!fibData) return [];
    return resolveFibLabels(
      fibData.retLevels, fibData.extLevels,
      rawMin, rawMax,
      plot.height, plot.top,
    );
  }, [fibData, rawMin, rawMax, plot.height, plot.top]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Advanced Indicators Panel
  // ═══════════════════════════════════════════════════════════════════════════

  // Compact summary of active indicators for collapsed header
  const activeNames = useMemo(() => {
    const names: string[] = [];
    if (indicators.bollinger) names.push("BB");
    if (indicators.fibRetracement) names.push("Fib R");
    if (indicators.fibExtension) names.push("Fib E");
    if (indicators.ichimoku) names.push("Ichi");
    if (indicators.pitchfork) names.push("Pitchfork");
    if (indicators.stochastic) names.push("Stoch");
    if (indicators.macd) names.push("MACD");
    if (indicators.adx) names.push("ADX");
    if (indicators.stdDev) names.push("StdDev");
    if (indicators.logScale) names.push("Log");
    return names;
  }, [indicators]);

  const indicatorPanel = (
    <div className={`mt-3 mb-1 rounded-lg border transition-colors ${
      panelOpen
        ? "border-accent/30 bg-gradient-to-b from-surface-elevated/40 via-surface-elevated/20 to-surface/80 shadow-lg shadow-black/20"
        : activeCount > 0
          ? "border-accent/20 bg-surface-elevated/15"
          : "border-surface-border/60 bg-surface-elevated/10 hover:border-surface-border hover:bg-surface-elevated/20"
    }`}>
      {/* Header */}
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-xs font-semibold transition-colors rounded-lg group ${
          panelOpen
            ? "text-slate-100"
            : "text-neutral hover:text-slate-200"
        }`}
      >
        <span className={`transition-transform ${panelOpen ? "rotate-0" : "-rotate-90"}`}>
          <ChevronDown className="h-4 w-4" />
        </span>
        <Activity className={`h-4 w-4 ${activeCount > 0 ? "text-accent" : "text-neutral/60 group-hover:text-neutral"}`} />
        <span className="text-[13px]">Advanced Indicators</span>

        {/* Active count badge */}
        {activeCount > 0 && (
          <span className="ml-1 inline-flex items-center rounded-full bg-accent/25 px-2.5 py-0.5 text-[10px] font-bold text-accent tabular-nums ring-1 ring-accent/20">
            {activeCount}
          </span>
        )}

        {/* Collapsed summary — compact list of active indicator names */}
        {!panelOpen && activeNames.length > 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] font-normal text-neutral/50 truncate max-w-[50%]">
            {activeNames.slice(0, 4).join(" · ")}
            {activeNames.length > 4 && <span className="text-neutral/30">+{activeNames.length - 4}</span>}
          </span>
        )}

        {/* Expand hint when collapsed and empty */}
        {!panelOpen && activeNames.length === 0 && (
          <span className="ml-auto text-[10px] font-normal text-neutral/30 group-hover:text-neutral/50 transition-colors">
            click to configure
          </span>
        )}
      </button>

      {panelOpen && (
        <div className="border-t border-white/[0.06] px-4 py-4 space-y-5">
          {/* Clutter warnings */}
          {overlayCount >= OVERLAY_WARN_THRESHOLD && (
            <ClutterWarning message={`${overlayCount} overlays active \u2014 chart may be hard to read. Consider disabling one.`} />
          )}
          {paneCount >= PANE_WARN_THRESHOLD && (
            <ClutterWarning message={`${paneCount} oscillator panes active \u2014 consider focusing on fewer indicators.`} />
          )}

          {/* ── Price Overlays ──────────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-1.5 mb-2.5">
              <Layers className="h-3.5 w-3.5 text-neutral/50" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-neutral/60">Price Overlays</span>
              {overlayCount > 0 && (
                <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold text-neutral/50 tabular-nums">{overlayCount} on</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <TogglePill active={indicators.bollinger} onClick={() => toggle("bollinger")} disabled={data.length < MIN_BARS.bollinger} color="#06b6d4">
                Bollinger
              </TogglePill>
              <TogglePill active={indicators.fibRetracement} onClick={() => toggle("fibRetracement")} disabled={data.length < MIN_BARS.fibRetracement} color={FIB_RET_COLOR}>
                Fib Retracement
              </TogglePill>
              <TogglePill active={indicators.fibExtension} onClick={() => toggle("fibExtension")} disabled={data.length < MIN_BARS.fibExtension} color={FIB_EXT_COLOR}>
                Fib Extension
              </TogglePill>
              <TogglePill active={indicators.ichimoku} onClick={() => toggle("ichimoku")} disabled={data.length < MIN_BARS.ichimoku} color={ICHIMOKU_COLORS.tenkan}>
                Ichimoku
              </TogglePill>
              <TogglePill
                active={indicators.pitchfork}
                onClick={() => toggle("pitchfork")}
                disabled={anchors.length < MAX_PITCHFORK_ANCHORS}
                color={PITCHFORK_COLOR}
                title={anchors.length < MAX_PITCHFORK_ANCHORS ? `Place ${MAX_PITCHFORK_ANCHORS} anchors first (${anchors.length}/${MAX_PITCHFORK_ANCHORS})` : undefined}
              >
                Pitchfork
              </TogglePill>
            </div>

            {/* ── Anchor selection controls ───────────────────────────── */}
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setAnchorMode((m) => !m)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all border ${
                  anchorMode
                    ? "border-pink-500/60 bg-pink-500/15 text-pink-300 shadow-sm shadow-pink-500/10"
                    : "border-surface-border/50 text-neutral hover:border-slate-500 hover:text-slate-200"
                }`}
              >
                {anchorMode ? <Crosshair className="h-3 w-3" /> : <MousePointer2 className="h-3 w-3" />}
                {anchorMode ? "Placing anchors\u2026" : "Set Anchors"}
              </button>

              <span className="text-[10px] font-mono tabular-nums text-neutral/60">
                {anchors.length}/{MAX_PITCHFORK_ANCHORS}
                {anchors.length >= MAX_PITCHFORK_ANCHORS && (
                  <span className="ml-1.5 text-emerald-400/80 font-semibold">Ready</span>
                )}
              </span>

              {anchors.length > 0 && (
                <button
                  onClick={clearAnchors}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-neutral/50 hover:text-red-400 transition-colors"
                  title="Clear all anchors"
                >
                  <RotateCcw className="h-3 w-3" />Clear
                </button>
              )}
            </div>
          </div>

          {/* ── Oscillator Panes ────────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-1.5 mb-2.5">
              <BarChart3 className="h-3.5 w-3.5 text-neutral/50" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-neutral/60">Oscillator Panes</span>
              {paneCount > 0 && (
                <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold text-neutral/50 tabular-nums">{paneCount} on</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <TogglePill active={indicators.stochastic} onClick={() => toggle("stochastic")} disabled={data.length < MIN_BARS.stochastic} color={STOCH_COLORS.k}>
                Stochastic
              </TogglePill>
              <TogglePill active={indicators.macd} onClick={() => toggle("macd")} disabled={data.length < MIN_BARS.macd} color={MACD_COLORS.macd}>
                MACD
              </TogglePill>
              <TogglePill active={indicators.adx} onClick={() => toggle("adx")} disabled={data.length < MIN_BARS.adx} color={ADX_COLORS.adx}>
                ADX
              </TogglePill>
              <TogglePill active={indicators.stdDev} onClick={() => toggle("stdDev")} disabled={data.length < MIN_BARS.stdDev} color={STDDEV_COLOR}>
                Std Dev
              </TogglePill>
            </div>
          </div>

          {/* ── Chart Options ──────────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-1.5 mb-2.5">
              <Settings2 className="h-3.5 w-3.5 text-neutral/50" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-neutral/60">Chart Options</span>
            </div>
            <div className="flex gap-1.5">
              <TogglePill active={indicators.logScale} onClick={() => toggle("logScale")} color="#8b5cf6">
                Log Scale
              </TogglePill>
            </div>
          </div>

          {/* ── AI Setup Analysis ──────────────────────────────────────── */}
          {symbol && (
            <div className="border-t border-white/[0.06] pt-4">
              <div className="flex items-center gap-1.5 mb-2.5">
                <Sparkles className="h-3.5 w-3.5 text-accent/70" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-neutral/60">Setup Interpretation</span>
              </div>

              <button
                onClick={analyzeSetup}
                disabled={setupLoading || !data.length}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all border ${
                  setupLoading
                    ? "border-accent/30 bg-accent/10 text-accent cursor-wait"
                    : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/50"
                }`}
              >
                {setupLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {setupLoading ? "Analyzing…" : setupAnalysis ? "Re-analyze Setup" : "Analyze Current Setup"}
              </button>

              {activeCount > 0 && !setupAnalysis && !setupLoading && (
                <p className="mt-1.5 text-[10px] text-neutral/40">
                  Analyzes {activeCount} active indicator{activeCount > 1 ? "s" : ""} on the {range.toUpperCase()} / {interval} chart
                </p>
              )}

              {setupError && (
                <div className="mt-2 rounded-lg border border-bear/30 bg-bear/10 p-2 text-xs text-bear">
                  {setupError}
                </div>
              )}

              {setupAnalysis && !setupLoading && (
                <div className="mt-3 space-y-2.5">
                  {/* Bias + Regime banner */}
                  <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-elevated/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        setupAnalysis.bias === "Bullish" ? "bg-bull/15 text-bull"
                        : setupAnalysis.bias === "Bearish" ? "bg-bear/15 text-bear"
                        : setupAnalysis.bias === "Mixed" ? "bg-amber-500/15 text-amber-400"
                        : "bg-slate-500/15 text-slate-400"
                      }`}>
                        {setupAnalysis.bias === "Bullish" ? <TrendingUp className="h-3 w-3" />
                        : setupAnalysis.bias === "Bearish" ? <TrendingDown className="h-3 w-3" />
                        : <Minus className="h-3 w-3" />}
                        {setupAnalysis.bias}
                      </span>
                      <span className="text-[10px] text-neutral/60">
                        {setupAnalysis.source === "gemini" ? "AI" : "Rule-based"}
                      </span>
                    </div>
                    <span className="text-[10px] text-neutral/40 capitalize">
                      {setupAnalysis.context.chartType} chart
                    </span>
                  </div>

                  {/* Regime */}
                  {setupAnalysis.regime && (
                    <p className="text-xs leading-relaxed text-slate-300">{setupAnalysis.regime}</p>
                  )}

                  {/* Evidence grid */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {setupAnalysis.bullishEvidence.length > 0 && (
                      <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-2">
                        <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-400">
                          <TrendingUp className="h-3 w-3" /> Bullish
                        </div>
                        <ul className="space-y-1">
                          {setupAnalysis.bullishEvidence.map((e, i) => (
                            <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-slate-300">
                              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                              {e}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {setupAnalysis.bearishEvidence.length > 0 && (
                      <div className="rounded-lg border border-red-500/15 bg-red-500/5 p-2">
                        <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase text-red-400">
                          <TrendingDown className="h-3 w-3" /> Bearish
                        </div>
                        <ul className="space-y-1">
                          {setupAnalysis.bearishEvidence.map((e, i) => (
                            <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-slate-300">
                              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                              {e}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Conflicts */}
                  {setupAnalysis.conflicts.length > 0 && (
                    <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-2">
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase text-amber-400">
                        <AlertOctagon className="h-3 w-3" /> Signal Conflicts
                      </div>
                      <ul className="space-y-1">
                        {setupAnalysis.conflicts.map((c, i) => (
                          <li key={i} className="text-[11px] leading-relaxed text-slate-400">{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Confirms / Invalidates */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-surface-elevated/30 p-2">
                      <div className="mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-400/70">
                        <Eye className="h-3 w-3" /> Confirms
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-400">{setupAnalysis.confirmsNext}</p>
                    </div>
                    <div className="rounded-lg bg-surface-elevated/30 p-2">
                      <div className="mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase text-red-400/70">
                        <AlertTriangle className="h-3 w-3" /> Invalidates
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-400">{setupAnalysis.invalidatesNext}</p>
                    </div>
                  </div>

                  {/* Context & Trust Footer */}
                  <div className="space-y-1.5 rounded-lg bg-surface-elevated/20 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-neutral/50">
                      <span className="font-semibold text-neutral/60">
                        {setupAnalysis.context.range.toUpperCase()} / {setupAnalysis.context.interval}
                      </span>
                      <span className="text-neutral/30">·</span>
                      <span>{setupAnalysis.indicatorsUsed.length} indicator{setupAnalysis.indicatorsUsed.length !== 1 ? "s" : ""}</span>
                      <span className="text-neutral/30">·</span>
                      <span className={setupAnalysis.hasMacroContext ? "text-accent/60" : "text-neutral/35"}>
                        Macro: {setupAnalysis.hasMacroContext ? "included" : "not included"}
                      </span>
                      <span className="text-neutral/30">·</span>
                      <span>
                        {setupAnalysis.source === "gemini" ? "AI" : "Rule-based"} · {(() => {
                          try { return formatDistanceToNow(parseISO(setupAnalysis.generatedAt), { addSuffix: true }); }
                          catch { return "just now"; }
                        })()}
                      </span>
                    </div>
                    <p className="text-[8px] text-neutral/30">AI-generated interpretation — not financial advice</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Range / Interval Bar + Active Legend
  // ═══════════════════════════════════════════════════════════════════════════

  const selectorBar = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-5">
        {/* Range */}
        <div>
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral">Range</span>
          <div className="flex items-center gap-0.5">
            {RANGES.map(({ label, value }) => (
              <button key={value} onClick={() => handleRange(value)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${range === value ? "bg-accent text-white" : "text-neutral hover:bg-surface-elevated hover:text-slate-200"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {/* Interval */}
        <div>
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral">Interval</span>
          <div className="flex items-center gap-0.5">
            {INTERVALS.map(({ label, value }) => {
              const dis = value === "1h" && !intradaySupported;
              return (
                <button key={value} onClick={() => !dis && handleInterval(value)} disabled={dis}
                  title={dis ? "Intraday data not available" : undefined}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${interval === value ? "bg-accent text-white" : dis ? "cursor-not-allowed text-neutral/40" : "text-neutral hover:bg-surface-elevated hover:text-slate-200"}`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {/* Chart Type */}
        <div>
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral">Type</span>
          <div className="flex items-center gap-0.5">
            {(["line", "candle"] as const).map((t) => (
              <button key={t} onClick={() => setChartType(t)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${chartType === t ? "bg-accent text-white" : "text-neutral hover:bg-surface-elevated hover:text-slate-200"}`}>
                {t === "line" ? "Line" : "Candle"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Active indicator legend — compact, only shows what's currently on */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] min-h-[18px]">
        {/* MAs are always shown */}
        <Swatch color={MA_COLORS.ma20} label="MA20" dashed />
        <Swatch color={MA_COLORS.ma50} label="MA50" />
        <Swatch color={MA_COLORS.ma200} label="MA200" />
        {indicators.bollinger && <Swatch color={BOLLINGER_COLORS.upper} label="BB" dashed />}
        {indicators.fibRetracement && <Swatch color={FIB_RET_COLOR} label="Fib R" />}
        {indicators.fibExtension && <Swatch color={FIB_EXT_COLOR} label="Fib E" dashed />}
        {indicators.ichimoku && (
          <>
            <Swatch color={ICHIMOKU_COLORS.tenkan} label="Tenkan" />
            <Swatch color={ICHIMOKU_COLORS.kijun} label="Kijun" />
            <span className="text-neutral/30">Cloud</span>
          </>
        )}
        {indicators.pitchfork && anchors.length === MAX_PITCHFORK_ANCHORS && <Swatch color={PITCHFORK_COLOR} label="Andrews' Pitchfork" />}
        {indicators.logScale && (
          <span className="flex items-center gap-1 text-purple-400/70">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />Log
          </span>
        )}
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Loading / Empty
  // ═══════════════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="rounded-xl border border-surface-border bg-surface p-4">
        {selectorBar}{indicatorPanel}
        <div className="flex h-[360px] items-center justify-center">
          <div className="animate-pulse text-sm text-neutral">Loading chart...</div>
        </div>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="rounded-xl border border-surface-border bg-surface p-4">
        {selectorBar}{indicatorPanel}
        <div className="flex h-[360px] flex-col items-center justify-center gap-2">
          <BarChart3 className="h-8 w-8 text-neutral/20" />
          <p className="text-sm font-medium text-neutral">No chart data available</p>
          {error && <p className="max-w-md text-center text-xs text-bear/70 font-mono leading-relaxed">{error}</p>}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Chart Render
  // ═══════════════════════════════════════════════════════════════════════════

  const oscH = 110;

  // ── Fib reference lines with collision-aware labels ─────────────────────
  const fibNodes: React.ReactNode[] = [];
  if (fibData) {
    // Build a lookup for resolved label info
    const labelLookup = new Map<string, ResolvedFibLabel>();
    for (const rl of resolvedFibLabels) {
      labelLookup.set(`${rl.side}-${rl.ratio}`, rl);
    }

    fibData.retLevels.forEach((lv, i) => {
      const resolved = labelLookup.get(`right-${lv.ratio}`);
      const isKey = resolved?.priority === 1;
      const showLabel = resolved?.visible ?? false;

      // Format: major = "61.8% $123.45", compact = "61.8%"
      const labelText = showLabel
        ? resolved?.showPrice
          ? `${lv.label} $${lv.price.toFixed(0)}`
          : lv.label
        : undefined;

      fibNodes.push(
        <ReferenceLine key={`fr-${i}`} y={lv.price} stroke={FIB_RET_COLOR}
          strokeDasharray={lv.ratio === 0 || lv.ratio === 1 ? "none" : "6 3"}
          strokeWidth={isKey ? 1 : 0.6} strokeOpacity={isKey ? 0.65 : 0.35}
          label={labelText ? (props: Record<string, unknown>) => (
            <FibLabel {...props} text={labelText} color={FIB_RET_COLOR} side="right" />
          ) : undefined}
        />
      );
    });

    fibData.extLevels.forEach((lv, i) => {
      const resolved = labelLookup.get(`left-${lv.ratio}`);
      const isKey = resolved?.priority === 1;
      const showLabel = resolved?.visible ?? false;

      const labelText = showLabel
        ? resolved?.showPrice
          ? `${lv.label} $${lv.price.toFixed(0)}`
          : lv.label
        : undefined;

      fibNodes.push(
        <ReferenceLine key={`fe-${i}`} y={lv.price} stroke={FIB_EXT_COLOR}
          strokeDasharray="4 4" strokeWidth={isKey ? 1 : 0.6} strokeOpacity={isKey ? 0.6 : 0.3}
          label={labelText ? (props: Record<string, unknown>) => (
            <FibLabel {...props} text={labelText} color={FIB_EXT_COLOR} side="left" />
          ) : undefined}
        />
      );
    });

    // Golden pocket shading
    const l382 = fibData.retLevels.find((l) => l.ratio === 0.382);
    const l618 = fibData.retLevels.find((l) => l.ratio === 0.618);
    if (l382 && l618) {
      fibNodes.push(
        <ReferenceArea key="gp" y1={Math.min(l382.price, l618.price)} y2={Math.max(l382.price, l618.price)}
          fill={FIB_RET_COLOR} fillOpacity={0.04} />
      );
    }
  }

  // ── Ichimoku cloud areas ────────────────────────────────────────────────
  const cloudNodes: React.ReactNode[] = [];
  if (indicators.ichimoku && enriched.length > 1) {
    for (let i = 0; i < enriched.length - 1; i++) {
      const c = enriched[i], n = enriched[i + 1];
      const a1 = c.senkouA, b1 = c.senkouB, a2 = n.senkouA, b2 = n.senkouB;
      if (a1 === undefined || b1 === undefined || a2 === undefined || b2 === undefined) continue;
      const bull = (a1 + a2) / 2 >= (b1 + b2) / 2;
      cloudNodes.push(
        <ReferenceArea key={`ic-${i}`} x1={c.date} x2={n.date}
          y1={Math.min(a1, b1, a2, b2)} y2={Math.max(a1, b1, a2, b2)}
          fill={bull ? ICHIMOKU_COLORS.senkouA : ICHIMOKU_COLORS.senkouB}
          fillOpacity={0.09} ifOverflow="extendDomain" />
      );
    }
  }

  // Reduce overlay opacity when multiple overlays are active
  const overlayOpacity = overlayCount >= 3 ? 0.5 : overlayCount >= 2 ? 0.7 : 1;

  return (
    <div className="rounded-xl border border-surface-border bg-surface p-4">
      {selectorBar}
      {indicatorPanel}

      {/* ── Anchor mode banner ─────────────────────────────────────────── */}
      {anchorMode && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-pink-500/8 border border-pink-500/20 px-3 py-1.5 text-[11px] text-pink-300/90">
          <Crosshair className="h-3.5 w-3.5 flex-shrink-0 animate-pulse" />
          <span>
            Click the chart to place anchor <span className="font-bold">{ANCHOR_LABELS[anchors.length] ?? "A?"}</span>
            <span className="ml-1 text-pink-300/50">({anchors.length}/{MAX_PITCHFORK_ANCHORS})</span>
          </span>
          <button onClick={() => setAnchorMode(false)} className="ml-auto text-[10px] text-pink-300/50 hover:text-pink-200 transition-colors">
            Cancel
          </button>
        </div>
      )}

      {/* ── Main Price Chart ──────────────────────────────────────────── */}
      <div className={`mt-3 ${anchorMode ? "cursor-crosshair" : ""}`} ref={chartContainerRef}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart data={enriched} margin={CHART_MARGIN} onClick={anchorMode ? handleChartClick : undefined}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e30" vertical={false} />
            <XAxis {...xAxisProps} />
            <YAxis
              scale={indicators.logScale ? "log" : "auto"}
              domain={indicators.logScale
                ? [(d: number) => Math.max(d * 0.97, 0.01), (d: number) => d * 1.03]
                : [rawMin, rawMax]}
              allowDataOverflow={indicators.logScale}
              tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => "$" + Number(v).toFixed(0)} width={Y_AXIS_WIDTH}
            />
            <Tooltip content={<PriceTooltip isCandle={chartType === "candle"} />} />

            {/* Fib zones & lines — behind overlays */}
            {fibNodes}

            {/* Ichimoku cloud — behind lines */}
            {cloudNodes}

            {/* Bollinger Bands */}
            {indicators.bollinger && (
              <>
                <Area type="monotone" dataKey="bbUpper" name="BB Upper" stroke={BOLLINGER_COLORS.upper}
                  strokeWidth={0.8} strokeDasharray="3 3" strokeOpacity={overlayOpacity} fill="none" dot={false} connectNulls isAnimationActive={false} />
                <Area type="monotone" dataKey="bbLower" name="BB Lower" stroke={BOLLINGER_COLORS.lower}
                  strokeWidth={0.8} strokeDasharray="3 3" strokeOpacity={overlayOpacity} fill="none" dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="bbMiddle" name="BB Mid" stroke={BOLLINGER_COLORS.middle}
                  strokeWidth={0.8} strokeOpacity={overlayOpacity * 0.4} dot={false} connectNulls isAnimationActive={false} />
              </>
            )}

            {/* Ichimoku lines */}
            {indicators.ichimoku && data.length >= MIN_BARS.ichimoku && (
              <>
                <Line type="monotone" dataKey="tenkan" name="Tenkan" stroke={ICHIMOKU_COLORS.tenkan}
                  strokeWidth={1} strokeOpacity={overlayOpacity} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="kijun" name="Kijun" stroke={ICHIMOKU_COLORS.kijun}
                  strokeWidth={1} strokeOpacity={overlayOpacity} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="senkouA" name="Span A" stroke={ICHIMOKU_COLORS.senkouA}
                  strokeWidth={0.8} strokeOpacity={overlayOpacity * 0.6} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="senkouB" name="Span B" stroke={ICHIMOKU_COLORS.senkouB}
                  strokeWidth={0.8} strokeOpacity={overlayOpacity * 0.6} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="chikou" name="Chikou" stroke={ICHIMOKU_COLORS.chikou}
                  strokeWidth={0.8} strokeDasharray="2 2" strokeOpacity={overlayOpacity * 0.5} dot={false} connectNulls isAnimationActive={false} />
              </>
            )}

            {/* Price line / invisible tracking area (always present for tooltip) */}
            <Area type="monotone" dataKey="close" name="Price"
              stroke={chartType === "candle" ? "transparent" : "#3b82f6"}
              strokeWidth={chartType === "candle" ? 0 : 2}
              fill={chartType === "candle" ? "transparent" : "url(#priceGrad)"}
              dot={false}
              activeDot={chartType === "candle" ? false : { r: 4, fill: "#3b82f6" }}
              isAnimationActive={false}
            />

            {/* Candlestick rendering */}
            {chartType === "candle" && (
              <Customized
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                component={(chartProps: any) => {
                  const xAx = chartProps.xAxisMap && Object.values(chartProps.xAxisMap)[0] as
                    { scale?: (v: string) => number; bandSize?: number } | undefined;
                  const yAx = chartProps.yAxisMap && Object.values(chartProps.yAxisMap)[0] as
                    { scale?: (v: number) => number } | undefined;
                  if (!xAx?.scale || !yAx?.scale) return <g />;

                  const n = enriched.length;
                  if (n === 0) return <g />;

                  // Compute candle width from data density
                  const firstX = xAx.scale(enriched[0].date);
                  const lastX = n > 1 ? xAx.scale(enriched[n - 1].date) : firstX;
                  const spacing = n > 1 ? (lastX - firstX) / (n - 1) : 20;
                  const candleW = Math.max(1, Math.min(14, spacing * 0.65));
                  const halfW = candleW / 2;

                  return (
                    <g className="candlesticks">
                      {enriched.map((d, i) => {
                        if (d._ichimokuFuture || d.close === 0) return null;
                        const cx = xAx.scale!(d.date) + ((xAx.bandSize ?? 0) / 2);
                        const yHigh = yAx.scale!(d.high);
                        const yLow = yAx.scale!(d.low);
                        const yOpen = yAx.scale!(d.open);
                        const yClose = yAx.scale!(d.close);

                        const bull = d.close > d.open;
                        const doji = Math.abs(d.close - d.open) / d.open < 0.001;
                        const color = doji ? CANDLE_DOJI : bull ? CANDLE_BULL : CANDLE_BEAR;

                        const bodyTop = Math.min(yOpen, yClose);
                        const bodyH = Math.max(1, Math.abs(yOpen - yClose));

                        return (
                          <g key={`candle-${i}`}>
                            {/* Wick */}
                            <line x1={cx} x2={cx} y1={yHigh} y2={yLow}
                              stroke={color} strokeWidth={1} strokeOpacity={0.8} />
                            {/* Body */}
                            <rect
                              x={cx - halfW} y={bodyTop}
                              width={candleW} height={bodyH}
                              fill={bull ? "transparent" : color}
                              stroke={color}
                              strokeWidth={bull ? 1.2 : 0}
                              rx={0.5}
                              opacity={0.9}
                            />
                          </g>
                        );
                      })}
                    </g>
                  );
                }}
              />
            )}

            {/* Moving Averages */}
            <Line type="monotone" dataKey="ma20" name="MA20" stroke={MA_COLORS.ma20} strokeWidth={1.3} dot={false} strokeDasharray="4 2" connectNulls />
            <Line type="monotone" dataKey="ma50" name="MA50" stroke={MA_COLORS.ma50} strokeWidth={1.3} dot={false} connectNulls />
            <Line type="monotone" dataKey="ma200" name="MA200" stroke={MA_COLORS.ma200} strokeWidth={1.3} dot={false} connectNulls />

            {/* Anchor dots */}
            {anchors.map((a, i) => (
              <ReferenceDot key={`anchor-${i}`} x={a.date} y={a.price}
                r={5} fill={ANCHOR_COLOR} stroke="#fff" strokeWidth={1.5}
                label={{ value: ANCHOR_LABELS[i], position: "top", fill: ANCHOR_COLOR, fontSize: 10, fontWeight: 700, offset: 8 }}
              />
            ))}

            {/* Andrews' Pitchfork (5-line) — rendered via Customized for real chart scales */}
            {indicators.pitchfork && anchors.length === MAX_PITCHFORK_ANCHORS && (
              <Customized
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                component={(chartProps: any) => {
                  const xAx = chartProps.xAxisMap && Object.values(chartProps.xAxisMap)[0] as { scale?: (v: string) => number; bandSize?: number } | undefined;
                  const yAx = chartProps.yAxisMap && Object.values(chartProps.yAxisMap)[0] as { scale?: (v: number) => number } | undefined;
                  if (!xAx?.scale || !yAx?.scale) return <g />;

                  const pts = anchors.map((a) => ({
                    x: xAx.scale!(a.date) + ((xAx.bandSize ?? 0) / 2),
                    y: yAx.scale!(a.price),
                  }));
                  const [p1, p2, p3] = pts;

                  // Midpoint of A2–A3
                  const mx = (p2.x + p3.x) / 2;
                  const my = (p2.y + p3.y) / 2;

                  // Direction vector: median line (P1 → midpoint)
                  const dx = mx - p1.x;
                  const dy = my - p1.y;
                  if (Math.abs(dx) < 1) return <g />;

                  // Extend lines 3× past the midpoint for visibility
                  const ext = 3;

                  // ── Warning lines ──
                  // Upper/lower tines pass through A2/A3 respectively.
                  // The perpendicular offset from median to upper tine = (A2 − median_at_same_x).
                  // Warning lines sit at 2× that offset from the median (i.e., 1× beyond the tine).
                  //
                  // In pixel space, the offset from the median origin (P1) to A2 is:
                  //   offsetUpper = (p2.x - p1.x, p2.y - p1.y) − projection onto median
                  // But since tines are parallel to median and pass through A2/A3,
                  // the perpendicular displacement is simply the vector from the median
                  // start-point on the line closest to A2, which equals (A2 - M) in the
                  // perpendicular direction. For parallel-translated lines, we just need:
                  //   upper tine origin = P2 (already at distance d from median)
                  //   upper warning origin = P2 + (P2 - closest point on median at P2.x)
                  //
                  // Simpler approach: the offset vector from the median to the upper tine
                  // at their common starting x is (p2 - medianPointAtP2x).
                  // The median at x = p2.x: parameterize median as P1 + t*(M - P1),
                  // where t maps P1.x to p2.x.
                  const tUpper = dx !== 0 ? (p2.x - p1.x) / dx : 0;
                  const medAtP2 = { x: p1.x + tUpper * dx, y: p1.y + tUpper * dy };
                  const offsetUpperX = p2.x - medAtP2.x;
                  const offsetUpperY = p2.y - medAtP2.y;

                  const tLower = dx !== 0 ? (p3.x - p1.x) / dx : 0;
                  const medAtP3 = { x: p1.x + tLower * dx, y: p1.y + tLower * dy };
                  const offsetLowerX = p3.x - medAtP3.x;
                  const offsetLowerY = p3.y - medAtP3.y;

                  // Warning line origins: tine origin + same offset again (2× from median)
                  const warnUpper = { x: p2.x + offsetUpperX, y: p2.y + offsetUpperY };
                  const warnLower = { x: p3.x + offsetLowerX, y: p3.y + offsetLowerY };

                  return (
                    <g>
                      {/* ── Warning lines (outermost, most subtle) ── */}
                      {/* Upper warning (2× above median) */}
                      <line x1={warnUpper.x} y1={warnUpper.y}
                        x2={warnUpper.x + dx * ext} y2={warnUpper.y + dy * ext}
                        stroke={PITCHFORK_COLOR} strokeWidth={1} strokeOpacity={0.45}
                        strokeDasharray="4 3" />
                      {/* Lower warning (2× below median) */}
                      <line x1={warnLower.x} y1={warnLower.y}
                        x2={warnLower.x + dx * ext} y2={warnLower.y + dy * ext}
                        stroke={PITCHFORK_COLOR} strokeWidth={1} strokeOpacity={0.45}
                        strokeDasharray="4 3" />

                      {/* ── Main tines (through A2, A3) ── */}
                      {/* Upper tine */}
                      <line x1={p2.x} y1={p2.y} x2={p2.x + dx * ext} y2={p2.y + dy * ext}
                        stroke={PITCHFORK_COLOR} strokeWidth={1} strokeOpacity={0.5}
                        strokeDasharray="6 3" />
                      {/* Lower tine */}
                      <line x1={p3.x} y1={p3.y} x2={p3.x + dx * ext} y2={p3.y + dy * ext}
                        stroke={PITCHFORK_COLOR} strokeWidth={1} strokeOpacity={0.5}
                        strokeDasharray="6 3" />

                      {/* ── Median line (primary, strongest) ── */}
                      <line x1={p1.x} y1={p1.y} x2={mx + dx * ext} y2={my + dy * ext}
                        stroke={PITCHFORK_COLOR} strokeWidth={1.5} strokeOpacity={0.7} />

                      {/* ── A2–A3 base line ── */}
                      <line x1={p2.x} y1={p2.y} x2={p3.x} y2={p3.y}
                        stroke={PITCHFORK_COLOR} strokeWidth={0.8} strokeOpacity={0.25}
                        strokeDasharray="3 3" />
                    </g>
                  );
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Volume ────────────────────────────────────────────────────── */}
      <ResponsiveContainer width="100%" height={60}>
        <BarChart data={enriched} margin={{ top: 0, right: CHART_MARGIN.right, bottom: 0, left: CHART_MARGIN.left }}>
          <XAxis dataKey="date" hide />
          <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false}
            tickFormatter={(v) => (v / 1_000_000).toFixed(0) + "M"} width={Y_AXIS_WIDTH} />
          <Tooltip formatter={(v: number) => [(v / 1_000_000).toFixed(1) + "M", "Volume"]}
            contentStyle={{ background: "#111118", border: "1px solid #252538", fontSize: 11 }} />
          <Bar dataKey="volume" fill="#3b82f620" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Oscillator Panes                                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      {/* Stochastic */}
      {indicators.stochastic && (
        <OscPane title="Stochastic (14, 3)" accentColor={STOCH_COLORS.k}
          subtitle={<><span style={{ color: STOCH_COLORS.k }}>%K</span>{" "}<span style={{ color: STOCH_COLORS.d }}>%D</span></>}>
          {data.length < MIN_BARS.stochastic ? (
            <div style={{ height: oscH }}><InsufficientNotice name="Stochastic" needed={MIN_BARS.stochastic} have={data.length} /></div>
          ) : (
            <ResponsiveContainer width="100%" height={oscH}>
              <ComposedChart data={enriched} margin={oscMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e30" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis domain={[0, 100]} ticks={[20, 50, 80]} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} />
                <ReferenceArea y1={80} y2={100} fill="#ef4444" fillOpacity={0.04} />
                <ReferenceArea y1={0} y2={20} fill="#22c55e" fillOpacity={0.04} />
                <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.3} />
                <ReferenceLine y={20} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.3} />
                <Tooltip content={<OscTooltip />} />
                <Line type="monotone" dataKey="stochK" name="%K" stroke={STOCH_COLORS.k} strokeWidth={1.3} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="stochD" name="%D" stroke={STOCH_COLORS.d} strokeWidth={1.3} dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </OscPane>
      )}

      {/* MACD */}
      {indicators.macd && (
        <OscPane title="MACD (12, 26, 9)" accentColor={MACD_COLORS.macd}
          subtitle={<><span style={{ color: MACD_COLORS.macd }}>MACD</span>{" "}<span style={{ color: MACD_COLORS.signal }}>Signal</span>{" "}<span className="text-neutral/30">Hist</span></>}>
          {data.length < MIN_BARS.macd ? (
            <div style={{ height: oscH }}><InsufficientNotice name="MACD" needed={MIN_BARS.macd} have={data.length} /></div>
          ) : (
            <ResponsiveContainer width="100%" height={oscH}>
              <ComposedChart data={enriched} margin={oscMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e30" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} />
                <ReferenceLine y={0} stroke="#334155" strokeWidth={0.5} />
                <Tooltip content={<OscTooltip />} />
                <Bar dataKey="macdHist" name="Hist" isAnimationActive={false} radius={[1, 1, 0, 0]}>
                  {enriched.map((e, i) => (
                    <Cell key={i} fill={(e.macdHist ?? 0) >= 0 ? MACD_COLORS.histUp + "60" : MACD_COLORS.histDown + "60"} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="macdLine" name="MACD" stroke={MACD_COLORS.macd} strokeWidth={1.3} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="macdSignal" name="Signal" stroke={MACD_COLORS.signal} strokeWidth={1.3} dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </OscPane>
      )}

      {/* ADX */}
      {indicators.adx && (
        <OscPane title="ADX (14)" accentColor={ADX_COLORS.adx}
          subtitle={<><span style={{ color: ADX_COLORS.adx }}>ADX</span>{" "}<span style={{ color: ADX_COLORS.plusDI }}>+DI</span>{" "}<span style={{ color: ADX_COLORS.minusDI }}>&minus;DI</span></>}>
          {data.length < MIN_BARS.adx ? (
            <div style={{ height: oscH }}><InsufficientNotice name="ADX" needed={MIN_BARS.adx} have={data.length} /></div>
          ) : (
            <ResponsiveContainer width="100%" height={oscH}>
              <ComposedChart data={enriched} margin={oscMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e30" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis domain={[0, "auto"]} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} />
                <ReferenceLine y={20} stroke="#64748b" strokeDasharray="3 3" strokeOpacity={0.35} />
                <ReferenceLine y={25} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.2} />
                <Tooltip content={<OscTooltip />} />
                <Line type="monotone" dataKey="adxVal" name="ADX" stroke={ADX_COLORS.adx} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="plusDI" name="+DI" stroke={ADX_COLORS.plusDI} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="minusDI" name="-DI" stroke={ADX_COLORS.minusDI} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </OscPane>
      )}

      {/* Std Deviation */}
      {indicators.stdDev && (
        <OscPane title="Std Deviation (20)" accentColor={STDDEV_COLOR}
          subtitle={<span className="text-neutral/30">rolling close-to-close % vol</span>}>
          {data.length < MIN_BARS.stdDev ? (
            <div style={{ height: oscH }}><InsufficientNotice name="Std Dev" needed={MIN_BARS.stdDev} have={data.length} /></div>
          ) : (
            <ResponsiveContainer width="100%" height={oscH}>
              <ComposedChart data={enriched} margin={oscMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e30" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.toFixed(1) + "%"} width={Y_AXIS_WIDTH} />
                <Tooltip content={<OscTooltip unit="%" />} />
                <Area type="monotone" dataKey="rollingStdDev" name="Std Dev" stroke={STDDEV_COLOR} strokeWidth={1.3}
                  fill={STDDEV_COLOR} fillOpacity={0.08} dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </OscPane>
      )}
    </div>
  );
}
