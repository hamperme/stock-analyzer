"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, TrendingDown, ChevronRight, RefreshCw, ArrowUpDown, AlertTriangle } from "lucide-react";
import { SetupBadge } from "@/components/ui/Badge";
import { SkeletonRow } from "@/components/ui/LoadingSpinner";
import type { WatchlistEntry } from "@/lib/types";

const REFRESH_MS = 5 * 60_000; // 5 minutes — store-first architecture reduces need for frequent polls

type SortKey = keyof WatchlistEntry;
type SortDir = "asc" | "desc";

function RSICell({ rsi }: { rsi: number }) {
  const color =
    rsi > 70 ? "text-bear" : rsi > 55 ? "text-bull" : rsi < 30 ? "text-warn" : "text-slate-300";
  return <span className={`font-mono font-semibold ${color}`}>{rsi.toFixed(1)}</span>;
}

function MAAlignCell({ alignment }: { alignment: WatchlistEntry["maAlignment"] }) {
  if (alignment === "bullish")
    return <span className="inline-flex items-center gap-1 text-bull"><TrendingUp className="h-3.5 w-3.5" /> Bullish</span>;
  if (alignment === "bearish")
    return <span className="inline-flex items-center gap-1 text-bear"><TrendingDown className="h-3.5 w-3.5" /> Bearish</span>;
  return <span className="text-warn">Mixed</span>;
}

export function WatchlistTable() {
  const router = useRouter();
  const [stocks, setStocks] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("setupScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchingRef = React.useRef(false);
  // Ref that always reflects the latest stocks state so the stable
  // useCallback (empty deps) can check whether rows already exist
  // without closing over a stale snapshot.
  const stocksRef = React.useRef(stocks);
  stocksRef.current = stocks;

  const fetchWatchlist = useCallback(async () => {
    // Prevent concurrent fetches
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000); // 90s max
      const res = await fetch("/api/watchlist", { signal: controller.signal });
      clearTimeout(timeout);
      const json = await res.json();

      // Debug: log the raw payload shape
      console.log("[WatchlistTable] /api/watchlist response:", {
        hasData: !!json.data,
        rowCount: Array.isArray(json.data) ? json.data.length : 0,
        stale: json.stale,
        source: json.source,
        error: json.error,
      });

      if (Array.isArray(json.data) && json.data.length > 0) {
        // We have rows — always show them, even if stale
        setStocks(json.data);
        setStale(!!json.stale);
        setLastUpdated(json.cachedAt ? new Date(json.cachedAt) : new Date());
        // Clear hard error — data is available
        setError(null);
      } else if (json.error) {
        // No data AND an error — only then show the error state
        // But do NOT clear existing stocks if we already have cached rows
        if (stocksRef.current.length === 0) {
          setError(json.error);
        }
        // If we have existing stocks, keep them visible and just mark stale
        setStale(true);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // Don't clear existing data on timeout — just mark stale
        if (stocksRef.current.length === 0) {
          setError("Request timed out — data may be loading. Try Full Refresh.");
        }
        setStale(true);
      } else {
        if (stocksRef.current.length === 0) {
          setError(e instanceof Error ? e.message : "Failed to load watchlist");
        }
        setStale(true);
      }
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();
    const interval = setInterval(fetchWatchlist, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchWatchlist]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sorted = [...stocks].sort((a, b) => {
    const av = a[sortKey] as number | string;
    const bv = b[sortKey] as number | string;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="cursor-pointer select-none px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral hover:text-slate-300"
      onClick={() => handleSort(field)}
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      </span>
    </th>
  );

  // Hard error with no data at all — show error banner
  if (error && stocks.length === 0) {
    return (
      <div className="rounded-xl border border-bear/30 bg-bear/10 p-6 text-sm text-bear">
        {error}
        <button onClick={fetchWatchlist} className="ml-3 underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-surface-border">
      <div className="flex items-center justify-between border-b border-surface-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral">Watchlist</h2>
          {stale && (
            <span className="inline-flex items-center gap-1 rounded-md bg-warn/10 px-2 py-0.5 text-[10px] font-medium text-warn">
              <AlertTriangle className="h-3 w-3" />
              STALE
            </span>
          )}
        </div>
        <button
          onClick={fetchWatchlist}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-neutral hover:bg-surface-elevated hover:text-slate-200 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Refresh"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-surface-border bg-surface-elevated/50">
            <tr>
              <SortHeader label="Symbol" field="symbol" />
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral">Name</th>
              <SortHeader label="Price" field="price" />
              <SortHeader label="Change %" field="changePercent" />
              <SortHeader label="Rel Vol" field="relativeVolume" />
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral">MA Align</th>
              <SortHeader label="RSI" field="rsi" />
              <SortHeader label="Score" field="setupScore" />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="bg-surface divide-y divide-surface-border">
            {loading
              ? [...Array(8)].map((_, i) => <SkeletonRow key={i} cols={9} />)
              : sorted.map((stock) => {
                  const isUp = stock.changePercent >= 0;
                  return (
                    <tr
                      key={stock.symbol}
                      onClick={() => router.push(`/stock/${stock.symbol}`)}
                      className="cursor-pointer transition-colors hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-bold text-slate-100">
                          {stock.symbol}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-neutral max-w-[140px] truncate">
                        {stock.shortName}
                      </td>
                      <td className="px-4 py-3 font-mono text-sm font-semibold text-slate-200">
                        ${stock.price.toFixed(2)}
                      </td>
                      <td className={`px-4 py-3 font-mono text-sm font-semibold ${isUp ? "text-bull" : "text-bear"}`}>
                        <span className="flex items-center gap-0.5">
                          {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                          {isUp ? "+" : ""}{stock.changePercent.toFixed(2)}%
                        </span>
                      </td>
                      <td className={`px-4 py-3 font-mono text-sm font-semibold ${stock.relativeVolume >= 1.5 ? "text-accent" : "text-slate-400"}`}>
                        {stock.relativeVolume.toFixed(2)}x
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <MAAlignCell alignment={stock.maAlignment} />
                      </td>
                      <td className="px-4 py-3">
                        <RSICell rsi={stock.rsi} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-slate-200">
                            {stock.setupScore}
                          </span>
                          <SetupBadge label={stock.setupLabel} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className="h-4 w-4 text-neutral" />
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
