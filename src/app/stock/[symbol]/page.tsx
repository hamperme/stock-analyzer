"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { StockChart } from "@/components/stock/StockChart";
import { TechnicalPanel } from "@/components/stock/TechnicalPanel";
import { AIAnalysisPanel } from "@/components/stock/AIAnalysisPanel";
import { NewsPanel } from "@/components/stock/NewsPanel";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import type { StockQuote, TechnicalIndicators, ChartDataPoint } from "@/lib/types";

interface StockData {
  quote: StockQuote;
  indicators: TechnicalIndicators;
  hasHistory: boolean;
}

export default function StockDetailPage() {
  const params = useParams();
  const router = useRouter();
  const symbol = (params.symbol as string).toUpperCase();

  const [stockData, setStockData] = useState<StockData | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartDays, setChartDays] = useState(365);
  const [loadingStock, setLoadingStock] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStock = useCallback(async () => {
    try {
      const res = await fetch(`/api/stock/${symbol}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setStockData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to load ${symbol}`);
    } finally {
      setLoadingStock(false);
    }
  }, [symbol]);

  const fetchChart = useCallback(async (days: number) => {
    setLoadingChart(true);
    try {
      const res = await fetch(`/api/stock/${symbol}/history?days=${days}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setChartData(json.data ?? []);
    } catch {
      // Chart failure is non-fatal
    } finally {
      setLoadingChart(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchStock();
    fetchChart(chartDays);
  }, [fetchStock, fetchChart, chartDays]);

  const handlePeriodChange = (days: number) => {
    setChartDays(days);
    fetchChart(days);
  };

  if (loadingStock) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <LoadingSpinner size="lg" />
        <p className="text-sm text-neutral">Loading {symbol}…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="rounded-xl border border-bear/30 bg-bear/10 p-6 text-center">
          <p className="text-base font-semibold text-bear">Failed to load {symbol}</p>
          <p className="mt-1 text-sm text-neutral">{error}</p>
          <div className="mt-4 flex gap-3 justify-center">
            <button
              onClick={fetchStock}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
            >
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
            <button
              onClick={() => router.push("/")}
              className="flex items-center gap-2 rounded-lg border border-surface-border px-4 py-2 text-sm text-neutral hover:bg-surface-elevated"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!stockData) return null;

  const { quote, indicators } = stockData;
  const isUp = quote.changePercent >= 0;

  return (
    <div className="space-y-5">
      {/* Back + Header */}
      <div>
        <button
          onClick={() => router.push("/")}
          className="mb-4 flex items-center gap-1.5 text-sm text-neutral hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black text-slate-100">{quote.symbol}</h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold ${
                  isUp ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
                }`}
              >
                {isUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {isUp ? "+" : ""}{quote.changePercent.toFixed(2)}%
              </span>
            </div>
            <p className="mt-0.5 text-base text-neutral">{quote.longName}</p>
          </div>

          <div className="text-right">
            <p className="text-4xl font-black text-slate-100">
              ${quote.price.toFixed(2)}
            </p>
            <p className={`text-sm font-semibold ${isUp ? "text-bull" : "text-bear"}`}>
              {isUp ? "+" : ""}{quote.change.toFixed(2)} today
            </p>
            <p className="text-xs text-neutral">{quote.currency}</p>
          </div>
        </div>
      </div>

      {/* Chart (full width) */}
      <StockChart
        data={chartData}
        onPeriodChange={handlePeriodChange}
        loading={loadingChart}
      />

      {/* Technical + AI panels side by side */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TechnicalPanel indicators={indicators} quote={quote} hasHistory={stockData.hasHistory} />
        <AIAnalysisPanel symbol={symbol} />
      </div>

      {/* News full width */}
      <NewsPanel symbol={symbol} />
    </div>
  );
}
