"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, TrendingUp, TrendingDown, RefreshCw, Database, Radio, Clock3 } from "lucide-react";
import { useSettings } from "@/components/app/SettingsProvider";
import { getAssetType } from "@/lib/assets";
import { StockChart } from "@/components/stock/StockChart";
import type { RangeValue, IntervalValue } from "@/components/stock/StockChart";
import { TechnicalPanel } from "@/components/stock/TechnicalPanel";
import { NewsPanel } from "@/components/stock/NewsPanel";
import { DerivativesPanel } from "@/components/stock/DerivativesPanel";
import { OptionsPanel } from "@/components/stock/OptionsPanel";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import type { StockQuote, TechnicalIndicators, ChartDataPoint, ChartDrawing } from "@/lib/types";

interface StockData {
  quote: StockQuote;
  indicators: TechnicalIndicators;
  hasHistory: boolean;
}

interface ChartMeta {
  source: string;
  stale: boolean;
  cachedAt: string | null;
  liveWarning: string | null;
  candle?: { lastBarAt: string | null; updatedAt: string | null; latencyMs: number | null; currentCandleOpen: boolean };
}

export default function StockDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { dict } = useSettings();
  const symbol = (params.symbol as string).toUpperCase();

  const [stockData, setStockData] = useState<StockData | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartCalculationData, setChartCalculationData] = useState<ChartDataPoint[]>([]);
  const [chartRange, setChartRange] = useState<RangeValue>("6m");
  const [chartInterval, setChartInterval] = useState<IntervalValue>("1d");
  const [intradaySupported, setIntradaySupported] = useState(false);
  const [loadingStock, setLoadingStock] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartMeta, setChartMeta] = useState<ChartMeta | null>(null);
  const [chartDrawings, setChartDrawings] = useState<ChartDrawing[]>([]);

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

  const fetchChart = useCallback(async (range: RangeValue, interval: IntervalValue, forceRefresh = false) => {
    setLoadingChart(true);
    setChartError(null);
    try {
      const refreshParam = forceRefresh ? "&refresh=1" : "";
      const res = await fetch(`/api/stock/${symbol}/history?range=${range}&interval=${interval}${refreshParam}`, { cache: "no-store" });
      const json = await res.json();
      setChartData(json.data ?? []);
      setChartCalculationData(json.calculationData ?? json.data ?? []);
      setIntradaySupported(json.intradaySupported ?? false);
      setChartMeta({ source: json.source ?? "unknown", stale: Boolean(json.stale), cachedAt: json.cachedAt ?? null, liveWarning: json.liveWarning ?? null, candle: json.candle });
      if (json.error) setChartError(json.error);
    } catch (e) {
      setChartError(e instanceof Error ? e.message : "Failed to load chart data");
    } finally {
      setLoadingChart(false);
    }
  }, [symbol]);

  const fetchDrawings = useCallback(async () => {
    try {
      const res = await fetch(`/api/stock/${symbol}/drawings?interval=${chartInterval}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setChartDrawings(json.data ?? []);
    } catch {
      // The drawing layer is optional and must never block market data.
    }
  }, [symbol, chartInterval]);

  const clearDrawings = useCallback(async () => {
    const res = await fetch(`/api/stock/${symbol}/drawings?interval=${chartInterval}&all=1`, { method: "DELETE" });
    if (res.ok) setChartDrawings([]);
  }, [symbol, chartInterval]);

  // Fetch stock data once on mount (symbol change)
  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  // Fetch chart whenever range or interval changes (including on mount)
  useEffect(() => {
    fetchChart(chartRange, chartInterval, true);
  }, [fetchChart, chartRange, chartInterval]);

  // A future model can POST drawing commands without coupling to this UI.
  // Polling keeps an open chart synchronized with those local tool calls.
  useEffect(() => {
    fetchDrawings();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") fetchDrawings();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [fetchDrawings]);

  // Keep the active candle current while this page is open. Also refresh when
  // the user returns to the tab after the browser was backgrounded.
  useEffect(() => {
    const intraday = ["1m", "5m", "15m", "1h", "4h"].includes(chartInterval);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") fetchChart(chartRange, chartInterval, true);
    }, intraday ? 60_000 : 5 * 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchChart(chartRange, chartInterval, true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchChart, chartRange, chartInterval]);

  const handleRangeChange = (range: RangeValue) => setChartRange(range);
  const handleIntervalChange = (interval: IntervalValue) => setChartInterval(interval);

  if (loadingStock) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <LoadingSpinner size="lg" />
        <p className="text-sm text-neutral">{dict.stockDetail.loading(symbol)}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="rounded-xl border border-bear/30 bg-bear/10 p-6 text-center">
          <p className="text-base font-semibold text-bear">{dict.stockDetail.failed(symbol)}</p>
          <p className="mt-1 text-sm text-neutral">{error}</p>
          <div className="mt-4 flex gap-3 justify-center">
            <button
              onClick={fetchStock}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
            >
              <RefreshCw className="h-4 w-4" /> {dict.common.retry}
            </button>
            <button
              onClick={() => router.push("/")}
              className="flex items-center gap-2 rounded-lg border border-surface-border px-4 py-2 text-sm text-neutral hover:bg-surface-elevated"
            >
              {dict.stockDetail.backToDashboard}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!stockData) return null;

  const { quote, indicators } = stockData;
  const isUp = quote.changePercent >= 0;
  const assetType = quote.assetType ?? getAssetType(quote.symbol);

  return (
    <div className="space-y-5">
      {/* Back + Header */}
      <div>
        <button
          onClick={() => router.push("/")}
          className="mb-4 flex items-center gap-1.5 text-sm text-neutral hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {dict.stockDetail.backToDashboard}
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black text-slate-100">{quote.symbol}</h1>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                assetType === "crypto" ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"
              }`}>
                {assetType === "crypto" ? dict.common.crypto : dict.common.stock}
              </span>
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
              {isUp ? "+" : ""}{quote.change.toFixed(2)} {dict.stockDetail.today}
            </p>
            <p className="text-xs text-neutral">{quote.currency}</p>
          </div>
        </div>
      </div>

      {/* Chart (full width) */}
      {chartMeta && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-surface-border bg-surface/60 px-3 py-2 text-xs text-neutral">
          <span className="flex items-center gap-1.5"><Database className="h-3.5 w-3.5" />{chartMeta.source}</span>
          <span className={`flex items-center gap-1.5 ${chartMeta.stale ? "text-warn" : "text-bull"}`}><Radio className="h-3.5 w-3.5" />{chartMeta.stale ? "Stale / cached" : "Feed healthy"}</span>
          {chartMeta.candle?.lastBarAt && <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Last bar {new Date(chartMeta.candle.lastBarAt).toLocaleString()}</span>}
          {chartMeta.candle && <span className={chartMeta.candle.currentCandleOpen ? "text-accent" : "text-slate-500"}>{chartMeta.candle.currentCandleOpen ? "● Current candle forming" : "✓ Candle confirmed"}</span>}
          {chartMeta.liveWarning && <span className="text-warn">Fallback: {chartMeta.liveWarning}</span>}
        </div>
      )}
      <StockChart
        data={chartData}
        calculationData={chartCalculationData}
        drawings={chartDrawings}
        activeRange={chartRange}
        activeInterval={chartInterval}
        intradaySupported={intradaySupported}
        onRangeChange={handleRangeChange}
        onIntervalChange={handleIntervalChange}
        onClearDrawings={clearDrawings}
        loading={loadingChart}
        error={chartError}
      />

      {assetType === "crypto" && <DerivativesPanel symbol={symbol} />}
      {assetType === "stock" && <OptionsPanel symbol={symbol} />}

      {/* Technical panel */}
      <div>
        <TechnicalPanel indicators={indicators} quote={quote} hasHistory={stockData.hasHistory} />
      </div>

      {/* News full width */}
      <NewsPanel symbol={symbol} />
    </div>
  );
}
