"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ScanLine } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { OptionsSnapshot } from "@/lib/types";

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);

function Metric({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "bull" | "bear" }) {
  return <div className="rounded-lg border border-surface-border bg-app-bg/40 p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral">{label}</p>
    <p className={`mt-1 text-xl font-black tabular-nums ${tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-slate-100"}`}>{value}</p>
    <p className="mt-1 text-xs text-slate-500">{hint}</p>
  </div>;
}

export function OptionsPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<OptionsSnapshot | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string>("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/stock/${symbol}/options`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.data) throw new Error(json.error ?? "Options feed unavailable");
      setData(json.data); setStale(Boolean(json.stale)); setError(null);
      setSelectedExpiry((current) => current || json.data.expiries?.[0]?.expiry || "");
    } catch (e) { setError(e instanceof Error ? e.message : "Options feed unavailable"); }
    finally { setLoading(false); }
  }, [symbol]);

  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 5 * 60_000); return () => clearInterval(timer); }, [refresh]);
  if (loading) return <Card className="h-48 animate-pulse bg-surface-elevated/30"><span className="sr-only">正在加载期权数据</span></Card>;
  if (!data) return <Card><p className="text-sm text-bear">期权数据暂不可用：{error}</p></Card>;

  const oiBear = data.putCallOiRatio > 1;
  const volumeBear = data.putCallVolumeRatio > 1;
  const expiry = data.expiries?.find((e) => e.expiry === selectedExpiry) ?? data.expiries?.[0];
  const maxStrikeOi = Math.max(1, ...(expiry?.strikes ?? []).flatMap((s) => [s.callOpenInterest, s.putOpenInterest]));
  return <Card>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-accent" /><div>
        <h2 className="font-bold text-slate-100">期权与仓位结构</h2>
        <p className="text-xs text-neutral">{symbol} · Cboe delayed quotes · 5 分钟刷新</p>
      </div></div>
      <div className="flex items-center gap-3 text-xs text-neutral"><span className={`h-2 w-2 rounded-full ${stale ? "bg-warn" : "bg-bull"}`} />{stale ? "缓存数据" : "数据正常"}<button onClick={refresh} className="rounded-md p-1.5 hover:bg-surface-elevated"><RefreshCw className="h-3.5 w-3.5" /></button></div>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="Put / Call OI" value={data.putCallOiRatio.toFixed(3)} hint={`${compact(data.putOpenInterest)} puts · ${compact(data.callOpenInterest)} calls`} tone={oiBear ? "bear" : "bull"} />
      <Metric label="Put / Call Volume" value={data.putCallVolumeRatio.toFixed(3)} hint={`${compact(data.putVolume)} puts · ${compact(data.callVolume)} calls`} tone={volumeBear ? "bear" : "bull"} />
      <Metric label="30D Implied Vol" value={`${data.iv30Pct.toFixed(1)}%`} hint={`30d expected move ±$${data.expectedMove30d.toFixed(2)}`} />
      <Metric label="Gamma Exposure" value={`${data.gammaExposure >= 0 ? "+" : "-"}$${compact(Math.abs(data.gammaExposure))}`} hint={data.gammaExposure >= 0 ? "正 Gamma · 波动压制偏好" : "负 Gamma · 波动放大风险"} tone={data.gammaExposure >= 0 ? "bull" : "bear"} />
    </div>
    <div className="mt-3 grid gap-3 lg:grid-cols-4">
      <div className="rounded-lg border border-surface-border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral">Expiry structure</p>
          <select value={selectedExpiry} onChange={(e) => setSelectedExpiry(e.target.value)} className="rounded border border-surface-border bg-surface-elevated px-1.5 py-1 text-xs text-slate-200">
            {(data.expiries ?? []).map((e) => <option key={e.expiry} value={e.expiry}>{e.expiry} ({e.daysToExpiry}d)</option>)}
          </select>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div><p className="text-[10px] text-neutral">Max Pain</p><p className="font-bold text-slate-100">{expiry?.maxPain == null ? "--" : `$${expiry.maxPain}`}</p></div>
          <div><p className="text-[10px] text-neutral">Call Wall</p><p className="font-bold text-bull">{expiry?.callWall == null ? "--" : `$${expiry.callWall}`}</p></div>
          <div><p className="text-[10px] text-neutral">Put Wall</p><p className="font-bold text-bear">{expiry?.putWall == null ? "--" : `$${expiry.putWall}`}</p></div>
        </div>
        <p className="mt-3 text-xs text-slate-500">Gamma flip estimate <span className="font-semibold text-slate-300">{expiry?.gammaFlipEstimate == null ? "--" : `$${expiry.gammaFlipEstimate}`}</span></p>
      </div>
      <div className="rounded-lg border border-surface-border p-3 lg:col-span-3">
        <div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wider text-neutral">Strike OI distribution</p><span className="text-[11px] text-slate-500">Puts ← strike → Calls</span></div>
        <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
          {(expiry?.strikes ?? []).map((s) => <div key={s.strike} className="grid grid-cols-[1fr_54px_1fr] items-center gap-1 text-[10px] tabular-nums">
            <div className="flex justify-end"><div className="h-2.5 rounded-l bg-bear/70" style={{ width: `${Math.max(2, s.putOpenInterest / maxStrikeOi * 100)}%` }} title={`Put OI ${s.putOpenInterest}`} /></div>
            <span className={`text-center ${Math.abs(s.strike - data.underlyingPrice) / data.underlyingPrice < .01 ? "font-bold text-accent" : "text-slate-400"}`}>${s.strike}</span>
            <div className="h-2.5 rounded-r bg-bull/70" style={{ width: `${Math.max(2, s.callOpenInterest / maxStrikeOi * 100)}%` }} title={`Call OI ${s.callOpenInterest}`} />
          </div>)}
        </div>
      </div>
      <div className="rounded-lg border border-surface-border p-3 lg:col-span-4">
        <div className="mb-2 flex justify-between"><p className="text-[11px] font-semibold uppercase tracking-wider text-neutral">异常期权成交</p><span className="text-[11px] text-slate-500">Volume &gt; OI, Volume ≥ 100</span></div>
        {data.unusualContracts.length ? <div className="space-y-1.5">{data.unusualContracts.map((o) => <div key={o.contract} className="grid grid-cols-[44px_1fr_auto] items-center gap-2 text-xs">
          <span className={`rounded px-1.5 py-0.5 text-center font-bold ${o.type === "call" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>{o.type.toUpperCase()}</span>
          <span className="truncate text-slate-300">${o.strike} · {o.expiry} · Vol {compact(o.volume)}</span>
          <span className="font-semibold tabular-nums text-slate-100">{o.volumeOiRatio.toFixed(1)}x OI</span>
        </div>)}</div> : <p className="text-xs text-slate-500">当前未发现符合阈值的异常合约</p>}
      </div>
    </div>
    <p className="mt-3 text-[11px] text-slate-500">数据时间 {new Date(data.updatedAt).toLocaleString()} · GEX 为基于公开 gamma 和 OI 的估算值</p>
    {error && <p className="mt-1 text-xs text-warn">最近刷新失败：{error}</p>}
  </Card>;
}
