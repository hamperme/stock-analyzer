"use client";

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/LoadingSpinner";
import type { MarketIndex } from "@/lib/types";

const REFRESH_MS = 5 * 60_000; // 5 minutes — store-first reduces polling pressure

export function MarketIndices() {
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch("/api/indices");
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setIndices(json.data ?? []);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load indices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const interval = setInterval(fetch_, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetch_]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-bear/30 bg-bear/10 p-4 text-sm text-bear">
        {error}
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {indices.map((index) => {
          const isUp = index.changePercent >= 0;
          return (
            <Card key={index.symbol}>
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
            </Card>
          );
        })}
      </div>
      {lastUpdated && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-neutral/60">
          <RefreshCw className="h-3 w-3" />
          Updated {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
