"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { BarChart3, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useSettings } from "@/components/app/SettingsProvider";
import { DASHBOARD_MARKET_OPTIONS, type DashboardMarket } from "@/lib/app-settings";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/LoadingSpinner";
import { formatStableLocalTime } from "@/lib/time";
import type { MarketIndex } from "@/lib/types";

const REFRESH_MS = 5 * 60_000; // 5 minutes — store-first reduces polling pressure

interface MarketIndicesProps {
  initialData?: MarketIndex[];
  initialError?: string | null;
  initialLastUpdated?: string | null;
  initialMarket?: DashboardMarket;
}

export function MarketIndices({
  initialData,
  initialError,
  initialLastUpdated,
  initialMarket = "us",
}: MarketIndicesProps) {
  const { dict, market, setMarket } = useSettings();
  const [indices, setIndices] = useState<MarketIndex[]>(initialData ?? []);
  const [loading, setLoading] = useState((initialData?.length ?? 0) === 0 && !initialError);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    initialLastUpdated ? new Date(initialLastUpdated) : null
  );
  const requestIdRef = useRef(0);

  const fetch_ = useCallback(async (selectedMarket: DashboardMarket, showLoading = false) => {
    const requestId = ++requestIdRef.current;
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`/api/indices?market=${selectedMarket}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (requestId !== requestIdRef.current) return;
      setIndices(json.data ?? []);
      setError(null);
      setLastUpdated(json.cachedAt ? new Date(json.cachedAt) : new Date());
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load indices");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const canUseInitialData = market === initialMarket && (initialData?.length ?? 0) > 0;
    if (!canUseInitialData) {
      void fetch_(market, true);
    }
    const interval = setInterval(() => {
      void fetch_(market);
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetch_, initialData, initialMarket, market]);

  const changeMarket = (nextMarket: DashboardMarket) => {
    if (nextMarket === market) return;
    setIndices([]);
    setError(null);
    setLastUpdated(null);
    setLoading(true);
    setMarket(nextMarket);
  };

  return (
    <Card className="h-full">
      <CardHeader className="items-start gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-accent" />
            <CardTitle>{dict.marketIndices.title}</CardTitle>
          </div>
          <p className="mt-1 text-sm text-neutral/70">
            {dict.marketIndices.descriptions[market]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:ml-auto">
          {DASHBOARD_MARKET_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => changeMarket(option)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                market === option
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-surface-border bg-surface-elevated text-neutral hover:border-accent/20 hover:text-slate-200"
              }`}
            >
              {dict.marketIndices.markets[option]}
            </button>
          ))}
        </div>
      </CardHeader>

      {error && indices.length === 0 ? (
        <div className="rounded-xl border border-bear/30 bg-bear/10 p-4 text-sm text-bear">
          {error}
        </div>
      ) : (
        <>
          {loading && indices.length === 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : indices.length === 0 ? (
            <div className="rounded-xl border border-surface-border bg-surface-elevated p-4 text-sm text-neutral">
              {dict.marketIndices.empty}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {indices.map((index) => {
                const isUp = index.changePercent >= 0;
                return (
                  <div key={`${market}:${index.symbol}`} className="rounded-xl border border-surface-border bg-surface-elevated p-4">
                    <p className="text-xs font-medium text-neutral">{index.name}</p>
                    <p className="mt-1 text-xl font-bold text-slate-100">
                      {index.price.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    <div className={`mt-1 flex items-center gap-1 text-sm font-medium ${isUp ? "text-bull" : "text-bear"}`}>
                      {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      <span>
                        {isUp ? "+" : ""}{index.change.toFixed(2)} ({isUp ? "+" : ""}
                        {index.changePercent.toFixed(2)}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(lastUpdated || error) && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              {lastUpdated ? (
                <p className="flex items-center gap-1 text-neutral/60">
                  <RefreshCw className="h-3 w-3" />
                  {dict.common.updatedAt(formatStableLocalTime(lastUpdated))}
                </p>
              ) : <span />}
              {error && indices.length > 0 ? (
                <p className="text-bear/90">{error}</p>
              ) : null}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
