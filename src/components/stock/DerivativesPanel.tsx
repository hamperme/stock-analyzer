"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Clock3, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { DerivativesPoint, DerivativesSnapshot } from "@/lib/types";

function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function signed(value: number, digits = 3) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function Sparkline({ points, positive }: { points: DerivativesPoint[]; positive?: boolean }) {
  if (points.length < 2) return <div className="h-12" />;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const coords = values.map((v, i) => `${(i / (values.length - 1)) * 100},${44 - ((v - lo) / span) * 38}`).join(" ");
  return (
    <svg viewBox="0 0 100 48" preserveAspectRatio="none" className="h-12 w-full" aria-hidden="true">
      <polyline points={coords} fill="none" stroke={positive === false ? "#ef4444" : "#10b981"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Metric({ label, value, hint, tone = "plain" }: { label: string; value: string; hint: string; tone?: "bull" | "bear" | "plain" }) {
  const color = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-slate-100";
  return (
    <div className="rounded-lg border border-surface-border bg-app-bg/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral">{label}</p>
      <p className={`mt-1 text-xl font-black tabular-nums ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

export function DerivativesPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<DerivativesSnapshot | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/stock/${symbol}/derivatives`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.data) throw new Error(json.error ?? "Derivatives feed unavailable");
      setData(json.data);
      setStale(Boolean(json.stale));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Derivatives feed unavailable");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (loading) return <Card className="h-48 animate-pulse bg-surface-elevated/30"><span className="sr-only">正在加载合约数据</span></Card>;
  if (!data) return <Card><p className="text-sm text-bear">合约数据暂不可用：{error}</p></Card>;

  const fundingTone = data.fundingRate > 0 ? "bear" : data.fundingRate < 0 ? "bull" : "plain";
  const oiTone = (data.openInterestChange24hPct ?? 0) >= 0 ? "bull" : "bear";
  const longTone = (data.longShortRatio ?? 1) >= 1 ? "bull" : "bear";
  const nextFunding = new Date(data.nextFundingTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <Card className="overflow-hidden">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-accent" />
          <div>
            <h2 className="font-bold text-slate-100">永续合约市场</h2>
            <p className="text-xs text-neutral">{data.exchangeSymbol} · Binance USDⓈ-M · 60 秒刷新</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral">
          <span className={`h-2 w-2 rounded-full ${stale ? "bg-warn" : "bg-bull"}`} />
          {stale ? "缓存数据" : "实时"}
          <button onClick={refresh} className="rounded-md p-1.5 hover:bg-surface-elevated" title="刷新">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Open Interest" value={`$${compact(data.openInterestUsd)}`} hint={`${compact(data.openInterest)} contracts · 24h ${data.openInterestChange24hPct == null ? "--" : signed(data.openInterestChange24hPct, 2)}`} tone={oiTone} />
        <Metric label="Funding / 8h" value={signed(data.fundingRate * 100, 4)} hint={`年化 ${signed(data.fundingAnnualizedPct, 2)} · 下次 ${nextFunding}`} tone={fundingTone} />
        <Metric label="Long / Short" value={data.longShortRatio?.toFixed(3) ?? "--"} hint={`${data.longAccountPct?.toFixed(1) ?? "--"}% Long · ${data.shortAccountPct?.toFixed(1) ?? "--"}% Short`} tone={longTone} />
        <Metric label="Taker Buy / Sell" value={data.takerBuySellRatio?.toFixed(3) ?? "--"} hint={(data.takerBuySellRatio ?? 1) >= 1 ? "主动买盘占优" : "主动卖盘占优"} tone={(data.takerBuySellRatio ?? 1) >= 1 ? "bull" : "bear"} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-surface-border p-3 lg:col-span-2">
          <div className="flex justify-between text-xs"><span className="font-semibold text-slate-300">OI 名义价值 · 24h</span><span className={oiTone === "bull" ? "text-bull" : "text-bear"}>{data.openInterestChange24hPct == null ? "--" : signed(data.openInterestChange24hPct, 2)}</span></div>
          <Sparkline points={data.oiHistory} positive={(data.openInterestChange24hPct ?? 0) >= 0} />
        </div>
        <div className="rounded-lg border border-surface-border p-3">
          <div className="flex justify-between text-xs"><span className="font-semibold text-slate-300">标记价格 / 基差</span><span className={data.basisPct >= 0 ? "text-bull" : "text-bear"}>{signed(data.basisPct, 3)}</span></div>
          <p className="mt-2 text-lg font-bold tabular-nums text-slate-100">${data.markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <p className="text-xs text-neutral">Index ${data.indexPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-500"><Clock3 className="h-3 w-3" />{new Date(data.updatedAt).toLocaleTimeString()}</div>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-warn">最近刷新失败：{error}</p>}
    </Card>
  );
}
