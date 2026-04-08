"use client";

import { useEffect, useState, useCallback } from "react";
import {
  TrendingUp,
  TrendingDown,
  Shield,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
  Brain,
  Eye,
  Activity,
  Clock,
  CheckCircle2,
  Circle,
  AlertCircle,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/LoadingSpinner";
import type { MacroView, MacroSnapshot, MacroDataPoint, MarketRegime, InputSignal, ConfidenceMeta } from "@/lib/types";

const REFRESH_MS = 30 * 60_000; // 30 minutes

// ─── Regime badge configuration ──────────────────────────────────────────────

const regimeConfig: Record<MarketRegime, { icon: typeof Zap; color: string; bg: string; border: string }> = {
  "Risk-On":  { icon: Zap,            color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  "Cautious": { icon: AlertTriangle,  color: "text-amber-400",   bg: "bg-amber-500/15",   border: "border-amber-500/30" },
  "Risk-Off": { icon: Shield,         color: "text-red-400",     bg: "bg-red-500/15",     border: "border-red-500/30" },
  "Mixed":    { icon: RefreshCw,      color: "text-slate-400",   bg: "bg-slate-500/15",   border: "border-slate-500/30" },
};

// ─── Macro data strip chip ──────────────────────────────────────────────────

function MacroChip({ label, value, change, positive }: {
  label: string;
  value: string;
  change?: string;
  positive?: boolean | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-surface-elevated/60 px-2.5 py-1.5 min-w-0 shrink-0">
      <span className="text-[10px] font-medium text-neutral/70 truncate">{label}</span>
      <span className="text-xs font-bold text-slate-200">{value}</span>
      {change && (
        <span className={`text-[10px] font-medium ${
          positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-slate-500"
        }`}>
          {change}
        </span>
      )}
    </div>
  );
}

function formatDP(dp: MacroDataPoint | null, decimals = 2): { value: string; change: string; positive: boolean | null } | null {
  if (!dp) return null;
  return {
    value: dp.value.toFixed(decimals),
    change: `${dp.change >= 0 ? "+" : ""}${dp.change.toFixed(decimals)}`,
    positive: dp.change > 0 ? true : dp.change < 0 ? false : null,
  };
}

// ─── Signal status dot ──────────────────────────────────────────────────────

function SignalDot({ signal }: { signal: InputSignal }) {
  const statusConfig: Record<InputSignal["status"], { color: string; Icon: typeof CheckCircle2; tip: string }> = {
    live:    { color: "text-emerald-400", Icon: CheckCircle2, tip: "Live data" },
    derived: { color: "text-sky-400",     Icon: Circle,       tip: "Derived signal" },
    proxy:   { color: "text-amber-400",   Icon: AlertCircle,  tip: "Proxy data" },
    stale:   { color: "text-amber-600",   Icon: Clock,        tip: "Stale data" },
    missing: { color: "text-slate-600",   Icon: Circle,       tip: "Missing" },
  };
  const cfg = statusConfig[signal.status];
  const Icon = cfg.Icon;

  return (
    <div className="flex items-center gap-1 group relative" title={`${signal.category}: ${signal.label} (${cfg.tip})`}>
      <Icon className={`h-2.5 w-2.5 ${cfg.color} ${signal.status === "missing" ? "opacity-40" : ""}`} />
      <span className={`text-[10px] ${signal.status === "missing" ? "text-neutral/30" : "text-neutral/70"}`}>
        {signal.category}
      </span>
    </div>
  );
}

// ─── Confidence bar ─────────────────────────────────────────────────────────

function ConfidenceBar({ confidence }: { confidence: ConfidenceMeta }) {
  const color = confidence.level === "High" ? "bg-emerald-400"
    : confidence.level === "Medium" ? "bg-amber-400"
    : "bg-slate-500";
  const textColor = confidence.level === "High" ? "text-emerald-400"
    : confidence.level === "Medium" ? "text-amber-400"
    : "text-slate-500";

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] font-semibold ${textColor}`}>
          {confidence.level}
        </span>
        <div className="h-1.5 w-16 rounded-full bg-surface-elevated overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${color}`}
            style={{ width: `${confidence.score}%` }}
          />
        </div>
        <span className="text-[10px] text-neutral/50">
          {confidence.score}%
        </span>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function MacroViewPanel() {
  const [data, setData] = useState<MacroView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/macro-view");
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json.data);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load macro view");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Loading ──
  if (loading) return <SkeletonCard className="h-56" />;

  // ── Error ──
  if (error || !data) {
    return (
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Brain className="h-4 w-4 text-indigo-400" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral">Macro Regime</h3>
        </div>
        <p className="text-sm text-neutral">
          {error ?? "No macro data available. Run a Full Refresh to populate market data, then reload."}
        </p>
      </Card>
    );
  }

  const regime = regimeConfig[data.regime] ?? regimeConfig["Mixed"];
  const RegimeIcon = regime.icon;
  const isAI = data.source === "gemini";
  const snap: MacroSnapshot | null = data.snapshot ?? null;
  const conf: ConfidenceMeta = data.confidence && typeof data.confidence === "object"
    ? data.confidence
    : { level: "Low" as const, score: 30, reasons: [], inputCoverage: 0, isStale: false, snapshotAgeMinutes: 0 };

  // Prepare macro data chips
  const t10y = snap ? formatDP(snap.treasury10Y) : null;
  const t2y  = snap ? formatDP(snap.treasury2Y) : null;
  const t3m  = snap ? formatDP(snap.treasury3M) : null;
  const vix  = snap ? formatDP(snap.vix, 1) : null;
  const dxy  = snap ? formatDP(snap.dxy) : null;
  const oil  = snap ? formatDP(snap.oil) : null;

  return (
    <Card className="overflow-hidden">
      {/* ═══ HEADER ═══════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Brain className="h-4 w-4 shrink-0 text-indigo-400" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral">
            Macro Regime
          </h3>
          {isAI ? (
            <span className="flex items-center gap-1 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-400 border border-indigo-500/30 shrink-0">
              <Sparkles className="h-3 w-3" />
              AI-Synthesized
            </span>
          ) : (
            <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-medium text-slate-500 border border-slate-500/30 shrink-0">
              Rule-Based
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${regime.color} ${regime.bg} border ${regime.border}`}>
            <RegimeIcon className="h-3.5 w-3.5" />
            {data.regime}
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-lg p-1 text-neutral transition-colors hover:bg-surface-elevated hover:text-slate-200"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ═══ MACRO DATA STRIP ═════════════════════════════════════════════════ */}
      {snap && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {t10y && (
            <MacroChip label="10Y Yield" value={`${t10y.value}%`} change={t10y.change} positive={t10y.positive} />
          )}
          {t2y && (
            <MacroChip label="2Y Yield" value={`${t2y.value}%`} change={t2y.change} positive={t2y.positive} />
          )}
          {t3m && (
            <MacroChip label="3M T-Bill" value={`${t3m.value}%`} change={t3m.change} positive={t3m.positive} />
          )}
          {snap.curveShape && snap.yieldCurve2s10s !== null && (
            <MacroChip
              label="2s10s"
              value={`${snap.yieldCurve2s10s > 0 ? "+" : ""}${snap.yieldCurve2s10s.toFixed(2)}`}
              change={snap.curveShape}
              positive={snap.curveShape === "Steep" || snap.curveShape === "Normal" ? true : snap.curveShape === "Inverted" ? false : null}
            />
          )}
          {snap.policyPath.source !== "unavailable" && (
            <MacroChip
              label="Policy Bias"
              value={snap.policyPath.bias}
              change="rates-derived"
              positive={snap.policyPath.bias === "Dovish" ? true : snap.policyPath.bias === "Hawkish" ? false : null}
            />
          )}
          {vix && (
            <MacroChip
              label="VIX"
              value={vix.value}
              change={vix.change}
              positive={vix.positive === true ? false : vix.positive === false ? true : null}
            />
          )}
          {dxy && (
            <MacroChip label="DXY" value={dxy.value} change={dxy.change} positive={dxy.positive} />
          )}
          {oil && (
            <MacroChip label="WTI" value={`$${oil.value}`} change={oil.change} positive={oil.positive} />
          )}
          {snap.fearGreed && (
            <MacroChip
              label="Fear & Greed"
              value={`${snap.fearGreed.score}`}
              change={snap.fearGreed.label}
              positive={snap.fearGreed.score > 50 ? true : snap.fearGreed.score < 40 ? false : null}
            />
          )}
          {snap.breadth.assessment && (
            <MacroChip
              label={snap.breadth.source === "etf-divergence" ? "Breadth (SPY/RSP)" : "Breadth (proxy)"}
              value={snap.breadth.assessment}
              change={snap.breadth.equalWeightDivergence !== null
                ? `${snap.breadth.equalWeightDivergence > 0 ? "+" : ""}${snap.breadth.equalWeightDivergence.toFixed(2)}pp`
                : snap.breadth.watchlist
                  ? `${snap.breadth.watchlist.advancers}A/${snap.breadth.watchlist.decliners}D`
                  : undefined}
              positive={snap.breadth.assessment === "Broad" || snap.breadth.assessment === "Healthy" ? true
                : snap.breadth.assessment === "Narrow" || snap.breadth.assessment === "Very Narrow" ? false
                : null}
            />
          )}
        </div>
      )}

      {/* ═══ COLLAPSED SUMMARY ════════════════════════════════════════════════ */}
      {!expanded && (
        <p className="mt-2 text-xs text-neutral line-clamp-2">
          {data.neutralSummary}
        </p>
      )}

      {/* ═══ EXPANDED CONTENT ═════════════════════════════════════════════════ */}
      {expanded && (
        <div className="mt-4 space-y-3">
          {/* Bull vs Bear columns */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Bull column */}
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Bull Case
                </span>
              </div>
              <ul className="space-y-1.5">
                {data.bullPoints.map((point, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-300">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            {/* Bear column */}
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <TrendingDown className="h-4 w-4 text-red-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-red-400">
                  Bear Case
                </span>
              </div>
              <ul className="space-y-1.5">
                {data.bearPoints.map((point, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-300">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Regime assessment */}
          <div className="rounded-lg border border-surface-border bg-surface-elevated/50 p-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Regime Assessment
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-300">
              {data.neutralSummary}
            </p>
          </div>

          {/* Watch Next */}
          {data.watchItems && data.watchItems.length > 0 && (
            <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
                  Watch Next
                </span>
              </div>
              <ul className="space-y-1">
                {data.watchItems.map((item, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-400">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ═══ SOURCE TRANSPARENCY + CONFIDENCE ═════════════════════════════ */}
          <div className="rounded-lg border border-surface-border bg-surface/50 p-3 space-y-2.5">
            {/* Signal status strip */}
            {snap?.signals && snap.signals.length > 0 && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral/50 block mb-1.5">
                  Inputs
                </span>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {snap.signals.map((sig) => (
                    <SignalDot key={sig.category} signal={sig} />
                  ))}
                </div>
              </div>
            )}

            {/* Confidence + freshness row */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pt-1 border-t border-surface-border/50">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-neutral/50">Confidence:</span>
                  <ConfidenceBar confidence={conf} />
                </div>
                {conf.reasons.length > 0 && (
                  <span className="text-[10px] text-neutral/40 hidden md:inline" title={conf.reasons.join(" | ")}>
                    {conf.reasons[0]}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[10px] text-neutral/50">
                {conf.isStale && (
                  <span className="flex items-center gap-1 text-amber-500">
                    <Clock className="h-2.5 w-2.5" />
                    Stale
                  </span>
                )}
                {lastUpdated && (
                  <span className="flex items-center gap-1">
                    <RefreshCw className="h-2.5 w-2.5" />
                    {lastUpdated.toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
