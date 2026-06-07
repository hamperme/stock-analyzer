"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, TrendingDown, ChevronRight, RefreshCw, ArrowUpDown, AlertTriangle, Search, Plus, Trash2, Loader2, X } from "lucide-react";
import { useSettings } from "@/components/app/SettingsProvider";
import { SetupBadge } from "@/components/ui/Badge";
import { SkeletonRow } from "@/components/ui/LoadingSpinner";
import { getAssetType } from "@/lib/assets";
import { formatStableLocalTime } from "@/lib/time";
import type { WatchlistEntry, WatchlistSearchResult } from "@/lib/types";

const REFRESH_MS = 5 * 60_000; // 5 minutes — store-first architecture reduces need for frequent polls

type SortKey = keyof WatchlistEntry;
type SortDir = "asc" | "desc";

function RSICell({ rsi }: { rsi: number }) {
  const color =
    rsi > 70 ? "text-bear" : rsi > 55 ? "text-bull" : rsi < 30 ? "text-warn" : "text-slate-300";
  return <span className={`font-mono font-semibold ${color}`}>{rsi.toFixed(1)}</span>;
}

function MAAlignCell({
  alignment,
  labels,
}: {
  alignment: WatchlistEntry["maAlignment"];
  labels: { bullish: string; bearish: string; mixed: string };
}) {
  if (alignment === "bullish")
    return <span className="inline-flex items-center gap-1 text-bull"><TrendingUp className="h-3.5 w-3.5" /> {labels.bullish}</span>;
  if (alignment === "bearish")
    return <span className="inline-flex items-center gap-1 text-bear"><TrendingDown className="h-3.5 w-3.5" /> {labels.bearish}</span>;
  return <span className="text-warn">{labels.mixed}</span>;
}

function AssetPill({
  assetType,
  labels,
}: {
  assetType: "stock" | "crypto";
  labels: { stock: string; crypto: string };
}) {
  const isCrypto = assetType === "crypto";
  return (
    <span
      className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isCrypto
          ? "bg-amber-500/15 text-amber-300"
          : "bg-sky-500/15 text-sky-300"
      }`}
    >
      {isCrypto ? labels.crypto : labels.stock}
    </span>
  );
}

interface WatchlistTableProps {
  initialData?: WatchlistEntry[];
  initialSymbols?: string[];
  initialError?: string | null;
  initialStale?: boolean;
  initialCachedAt?: string | null;
}

export function WatchlistTable({
  initialData,
  initialSymbols,
  initialError,
  initialStale,
  initialCachedAt,
}: WatchlistTableProps) {
  const router = useRouter();
  const { dict } = useSettings();
  const hasInitialState =
    initialData !== undefined ||
    initialSymbols !== undefined ||
    initialError !== undefined ||
    initialStale !== undefined ||
    initialCachedAt !== undefined;
  const [stocks, setStocks] = useState<WatchlistEntry[]>(initialData ?? []);
  const [symbols, setSymbols] = useState<string[]>(
    initialSymbols ?? initialData?.map((entry) => entry.symbol) ?? []
  );
  const [loading, setLoading] = useState(!hasInitialState);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [stale, setStale] = useState(!!initialStale);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    initialCachedAt ? new Date(initialCachedAt) : null
  );
  const [sortKey, setSortKey] = useState<SortKey>("setupScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WatchlistSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mutatingSymbol, setMutatingSymbol] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchingRef = React.useRef(false);
  // Ref that always reflects the latest stocks state so the stable
  // useCallback (empty deps) can check whether rows already exist
  // without closing over a stale snapshot.
  const stocksRef = React.useRef(stocks);
  stocksRef.current = stocks;

  const applyWatchlistPayload = useCallback((json: {
    data?: WatchlistEntry[];
    symbols?: string[];
    stale?: boolean;
    cachedAt?: string | null;
    error?: string | null;
  }) => {
    const rows = Array.isArray(json.data) ? json.data : [];
    setStocks(rows);
    setSymbols(Array.isArray(json.symbols) ? json.symbols : rows.map((row) => row.symbol));
    setStale(!!json.stale);
    setLastUpdated(json.cachedAt ? new Date(json.cachedAt) : rows.length > 0 ? new Date() : null);
    if (json.error && rows.length === 0) setError(json.error);
    else setError(null);
  }, []);

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
        symbolCount: Array.isArray(json.symbols) ? json.symbols.length : 0,
        stale: json.stale,
        source: json.source,
        error: json.error,
      });

      applyWatchlistPayload(json);
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
  }, [applyWatchlistPayload]);

  useEffect(() => {
    // Always revalidate on mount so client-side back/forward navigation
    // cannot get stuck on an older cached dashboard snapshot.
    fetchWatchlist();
    const interval = setInterval(fetchWatchlist, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchWatchlist]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const res = await fetch(`/api/watchlist/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Search failed");
        setSearchResults(Array.isArray(json.data) ? json.data : []);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setSearchError(e instanceof Error ? e.message : "Search failed");
          setSearchResults([]);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const handleAdd = useCallback(async (symbol: string) => {
    setMutatingSymbol(symbol);
    setMessage(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Failed to add ${symbol}`);
      applyWatchlistPayload(json);
      setQuery("");
      setSearchResults([]);
      setMessage(dict.watchlist.addedToWatchlist(symbol));
      React.startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : `Failed to add ${symbol}`);
    } finally {
      setMutatingSymbol(null);
    }
  }, [applyWatchlistPayload, dict.watchlist, router]);

  const handleRemove = useCallback(async (symbol: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setMutatingSymbol(symbol);
    setMessage(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Failed to remove ${symbol}`);
      applyWatchlistPayload(json);
      setMessage(dict.watchlist.removedFromWatchlist(symbol));
      React.startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to remove ${symbol}`);
    } finally {
      setMutatingSymbol(null);
    }
  }, [applyWatchlistPayload, dict.watchlist, router]);

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

  return (
    <div className="overflow-hidden rounded-xl border border-surface-border">
      <div className="flex items-center justify-between border-b border-surface-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral">{dict.watchlist.title}</h2>
          {stale && (
            <span className="inline-flex items-center gap-1 rounded-md bg-warn/10 px-2 py-0.5 text-[10px] font-medium text-warn">
              <AlertTriangle className="h-3 w-3" />
              {dict.watchlist.stale}
            </span>
          )}
        </div>
        <button
          onClick={fetchWatchlist}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-neutral hover:bg-surface-elevated hover:text-slate-200 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {lastUpdated ? dict.common.updatedAt(formatStableLocalTime(lastUpdated)) : dict.common.refresh}
        </button>
      </div>

      <div className="border-b border-surface-border bg-surface px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral/60" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={dict.watchlist.searchPlaceholder}
                className="w-full rounded-lg border border-surface-border bg-surface-elevated pl-9 pr-9 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-neutral/50 focus:border-accent"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    setSearchResults([]);
                    setSearchError(null);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral/60 hover:text-slate-200"
                  aria-label={dict.watchlist.clearSearch}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {message && (
            <p className="text-xs text-bull">{message}</p>
          )}

          {searchError && (
            <p className="text-xs text-bear">{searchError}</p>
          )}

          {(searchLoading || searchResults.length > 0 || (query.trim().length > 0 && !searchLoading)) && (
            <div className="rounded-lg border border-surface-border bg-surface-elevated/40">
              {searchLoading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-neutral">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {dict.watchlist.searching}
                </div>
              ) : searchResults.length > 0 ? (
                <div className="divide-y divide-surface-border">
                  {searchResults.map((result) => {
                    const alreadyAdded = symbols.includes(result.symbol);
                    const busy = mutatingSymbol === result.symbol;
                    return (
                      <div key={result.symbol} className="flex items-center justify-between gap-3 px-3 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-slate-100">{result.symbol}</span>
                            <AssetPill
                              assetType={result.assetType}
                              labels={{ stock: dict.common.stock, crypto: dict.common.crypto }}
                            />
                            {result.exchange && (
                              <span className="text-[11px] text-neutral/60">{result.exchange}</span>
                            )}
                          </div>
                          <p className="truncate text-sm text-neutral">{result.longName}</p>
                        </div>
                        <button
                          onClick={() => handleAdd(result.symbol)}
                          disabled={alreadyAdded || busy}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                          {alreadyAdded ? dict.watchlist.added : dict.watchlist.add}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : query.trim().length > 0 ? (
                <div className="px-3 py-3 text-sm text-neutral">{dict.watchlist.noMatches}</div>
              ) : null}
            </div>
          )}

          {error && stocks.length === 0 && (
            <div className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-sm text-bear">
              {error}
              <button onClick={fetchWatchlist} className="ml-3 underline">{dict.common.retry}</button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-surface-border bg-surface-elevated/50">
            <tr>
              <SortHeader label={dict.watchlist.symbol} field="symbol" />
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral">{dict.watchlist.name}</th>
              <SortHeader label={dict.watchlist.price} field="price" />
              <SortHeader label={dict.watchlist.changePercent} field="changePercent" />
              <SortHeader label={dict.watchlist.relativeVolume} field="relativeVolume" />
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral">{dict.watchlist.maAlign}</th>
              <SortHeader label={dict.watchlist.rsi} field="rsi" />
              <SortHeader label={dict.watchlist.score} field="setupScore" />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="bg-surface divide-y divide-surface-border">
            {loading
              ? [...Array(8)].map((_, i) => <SkeletonRow key={i} cols={9} />)
              : sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-neutral">
                    {dict.watchlist.empty}
                  </td>
                </tr>
              )
              : sorted.map((stock) => {
                  const isUp = stock.changePercent >= 0;
                  const assetType = stock.assetType ?? getAssetType(stock.symbol);
                  const busy = mutatingSymbol === stock.symbol;
                  return (
                    <tr
                      key={stock.symbol}
                      onClick={() => router.push(`/stock/${stock.symbol}`)}
                      className="cursor-pointer transition-colors hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-slate-100">
                            {stock.symbol}
                          </span>
                          <AssetPill
                            assetType={assetType}
                            labels={{ stock: dict.common.stock, crypto: dict.common.crypto }}
                          />
                        </div>
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
                        <MAAlignCell
                          alignment={stock.maAlignment}
                          labels={{
                            bullish: dict.common.bullish,
                            bearish: dict.common.bearish,
                            mixed: dict.common.mixed,
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <RSICell rsi={stock.rsi} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-slate-200">
                            {stock.setupScore}
                          </span>
                          <SetupBadge
                            label={stock.setupLabel}
                            displayLabel={dict.watchlist.setupLabels[stock.setupLabel]}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(event) => handleRemove(stock.symbol, event)}
                            disabled={busy}
                            className="rounded-md p-1 text-neutral transition-colors hover:bg-bear/10 hover:text-bear disabled:opacity-50"
                            aria-label={dict.watchlist.removeFromWatchlist(stock.symbol)}
                          >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                          <ChevronRight className="h-4 w-4 text-neutral" />
                        </div>
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
