import { NextResponse } from "next/server";
import { enrichBarsWithMAs, aggregateWeekly, aggregateMonthly } from "@/lib/calculations";
import { loadHistory, loadIntraday, saveIntraday } from "@/lib/store";
import { refreshRecentHistory } from "@/lib/refresh";
import { getIntradayData } from "@/lib/yahoo-finance";
import { getFuturesKlines } from "@/lib/binance-futures";
import { isCryptoSymbol } from "@/lib/assets";
import type { HistoricalBar } from "@/lib/types";

export const dynamic = "force-dynamic";

function rangeToDays(range: string): number {
  return ({ "1d": 1, "5d": 5, "1m": 30, "3m": 90, "6m": 180, "1y": 365, "2y": 730, all: 99999 } as Record<string, number>)[range.toLowerCase()] ?? 180;
}

function getBars(symbol: string): { bars: HistoricalBar[]; updatedAt: string | null; stale: boolean; source: string } {
  const stored = loadHistory(symbol);
  if (stored?.data.length) {
    return { bars: stored.data, updatedAt: stored.updatedAt, stale: stored.stale, source: "store" };
  }
  return { bars: [], updatedAt: null, stale: false, source: "empty" };
}

function barTime(date: string): number {
  return new Date(date.length <= 10 ? `${date}T00:00:00Z` : date).getTime();
}

function sliceByDays<T extends HistoricalBar>(bars: T[], days: number): T[] {
  if (days >= 99999 || !bars.length) return bars;
  const cutoff = barTime(bars[bars.length - 1].date) - days * 86_400_000;
  return bars.filter((bar) => barTime(bar.date) >= cutoff);
}

function withWarmup<T extends HistoricalBar>(all: T[], visible: T[], count = 250): T[] {
  if (!visible.length) return all.slice(-count);
  const first = all.findIndex((bar) => bar.date === visible[0].date);
  return all.slice(Math.max(0, first - count));
}

function aggregateFourHour(bars: HistoricalBar[]): HistoricalBar[] {
  const buckets = new Map<number, HistoricalBar[]>();
  for (const bar of bars) {
    const bucket = Math.floor(barTime(bar.date) / 14_400_000) * 14_400_000;
    const group = buckets.get(bucket) ?? [];
    group.push(bar); buckets.set(bucket, group);
  }
  return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([time, group]) => ({
    date: new Date(time).toISOString(), open: group[0].open,
    high: Math.max(...group.map((b) => b.high)), low: Math.min(...group.map((b) => b.low)),
    close: group[group.length - 1].close, volume: group.reduce((n, b) => n + b.volume, 0),
  }));
}

function candleMeta(bars: HistoricalBar[], interval: string, updatedAt: string | null) {
  const last = bars.at(-1);
  const durations: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
  const age = last ? Math.max(0, Date.now() - barTime(last.date)) : null;
  const duration = durations[interval] ?? 86_400_000;
  return { lastBarAt: last?.date ?? null, updatedAt, latencyMs: age, currentCandleOpen: age != null && age < duration * 1.5 };
}

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const { searchParams } = new URL(req.url);
  const legacyDays = searchParams.get("days");
  const rangeParam = searchParams.get("range") ?? (legacyDays ? "1y" : "6m");
  const intervalParam = (searchParams.get("interval") ?? "1d").toLowerCase();
  const forceRefresh = searchParams.get("refresh") === "1";
  const days = legacyDays ? Math.min(parseInt(legacyDays, 10), 730) : rangeToDays(rangeParam);

  const intradayIntervals = ["1m", "5m", "15m", "1h", "4h"] as const;
  if ((intradayIntervals as readonly string[]).includes(intervalParam)) {
    const requested = intervalParam as typeof intradayIntervals[number];
    let bars: HistoricalBar[] = [];
    let source = "empty";
    let updatedAt: string | null = null;
    let stale = false;
    let liveWarning: string | null = null;
    try {
      if (isCryptoSymbol(symbol)) {
        bars = await getFuturesKlines(symbol, requested, 1500);
        source = "binance-usdm";
      } else {
        const yahooInterval = requested === "4h" ? "1h" : requested;
        bars = await getIntradayData(symbol, yahooInterval, rangeParam, forceRefresh);
        if (requested === "4h") bars = aggregateFourHour(bars);
        source = "yahoo-intraday";
      }
      updatedAt = new Date().toISOString();
      saveIntraday(symbol, requested, bars);
    } catch (error) {
      liveWarning = (error as Error).message;
      const stored = loadIntraday(symbol, requested);
      if (stored) { bars = stored.data; updatedAt = stored.updatedAt; stale = true; source = "store"; }
    }
    const allEnriched = enrichBarsWithMAs(bars);
    const visible = sliceByDays(allEnriched, days);
    return NextResponse.json({
      data: visible, error: visible.length ? null : liveWarning ?? `No intraday history for ${symbol}`,
      cachedAt: updatedAt, stale, interval: requested, intradaySupported: true, source, liveWarning,
      candle: candleMeta(visible, requested, updatedAt), calculationData: withWarmup(allEnriched, visible),
    });
  }

  let liveWarning: string | null = null;
  if (forceRefresh) {
    try { await refreshRecentHistory(symbol); }
    catch (error) { liveWarning = (error as Error).message; }
  }
  const { bars: allBars, updatedAt, stale, source } = getBars(symbol);
  if (!allBars.length) return NextResponse.json({ data: [], error: `No history for ${symbol} — click Full Refresh to populate.`, cachedAt: null, stale: false, interval: intervalParam, source: "empty" });

  let aggregated: HistoricalBar[];
  if (intervalParam === "1w") aggregated = aggregateWeekly(allBars);
  else if (intervalParam === "1mo") aggregated = aggregateMonthly(allBars);
  else aggregated = allBars;
  const enriched = sliceByDays(enrichBarsWithMAs(aggregated), days);
  return NextResponse.json({
    data: enriched, error: null, cachedAt: updatedAt, stale, interval: intervalParam,
    intradaySupported: true, source, liveWarning, candle: candleMeta(enriched, intervalParam, updatedAt),
    calculationData: withWarmup(enrichBarsWithMAs(aggregated), enriched),
  });
}
