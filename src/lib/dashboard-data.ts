import { cache, TTL } from "@/lib/cache";
import { normalizeWatchlistEntry } from "@/lib/assets";
import type { AppAiProvider, DashboardMarket } from "@/lib/app-settings";
import { getWatchlistSymbols } from "@/lib/refresh";
import {
  loadFearGreed,
  loadIndices,
  loadMacroView,
  loadMeta,
  loadWatchlist,
} from "@/lib/store";
import type {
  FearGreedData,
  MacroView,
  MarketIndex,
  WatchlistEntry,
} from "@/lib/types";

export interface WatchlistPayload {
  data: WatchlistEntry[];
  symbols: string[];
  error: string | null;
  cachedAt: string | null;
  stale: boolean;
  source: string;
}

export interface IndicesPayload {
  data: MarketIndex[];
  error: string | null;
  cachedAt: string | null;
  stale: boolean;
  source: string;
}

export interface FearGreedPayload {
  data: FearGreedData | null;
  error: string | null;
  cachedAt: string | null;
  stale: boolean;
  source: string;
}

export interface MacroViewPayload {
  data: MacroView | null;
  error: string | null;
  cachedAt: string | null;
  stale: boolean;
  source: string;
}

export interface RefreshMetaPayload {
  lastFullRefresh: string | null;
  lastQuoteRefresh: string | null;
  refreshInProgress: boolean;
}

export function getWatchlistPayload(): WatchlistPayload {
  const symbols = getWatchlistSymbols();
  const stored = loadWatchlist();

  if (stored) {
    const data = stored.data
      .map(normalizeWatchlistEntry)
      .filter((entry) => symbols.includes(entry.symbol));
    return {
      data,
      symbols,
      error: null,
      cachedAt: stored.updatedAt,
      stale: stored.stale,
      source: "store",
    };
  }

  if (symbols.length === 0) {
    return {
      data: [],
      symbols: [],
      error: null,
      cachedAt: null,
      stale: false,
      source: "empty-config",
    };
  }

  return {
    data: [],
    symbols,
    error: "No watchlist data yet — click Full Refresh to populate.",
    cachedAt: null,
    stale: false,
    source: "empty",
  };
}

export function getInitialIndicesPayload(market: DashboardMarket = "us"): IndicesPayload {
  const cacheKey = `market:indices:${market}`;
  const cached = cache.get<MarketIndex[]>(cacheKey);
  if (cached) {
    return {
      data: cached,
      error: null,
      cachedAt: null,
      stale: false,
      source: "cache",
    };
  }

  const stored = loadIndices(market);
  if (stored) {
    return {
      data: stored.data,
      error: null,
      cachedAt: stored.updatedAt,
      stale: stored.stale,
      source: "store",
    };
  }

  return {
    data: [],
    error: "No cached indices yet. Run Full Refresh to populate market data.",
    cachedAt: null,
    stale: false,
    source: "empty",
  };
}

export function getInitialFearGreedPayload(): FearGreedPayload {
  const cached = cache.get<FearGreedData>("fear-greed");
  if (cached) {
    return {
      data: cached,
      error: null,
      cachedAt: null,
      stale: false,
      source: "cache",
    };
  }

  const stored = loadFearGreed();
  if (stored) {
    return {
      data: stored.data,
      error: null,
      cachedAt: stored.updatedAt,
      stale: stored.stale,
      source: "store",
    };
  }

  return {
    data: null,
    error: null,
    cachedAt: null,
    stale: false,
    source: "empty",
  };
}

export function getInitialMacroViewPayload(provider: AppAiProvider = "gemini"): MacroViewPayload {
  const cacheKey = `macro:view:${provider}`;
  const cached = cache.get<MacroView>(cacheKey);
  if (cached) {
    return {
      data: cached,
      error: null,
      cachedAt: null,
      stale: false,
      source: "cache",
    };
  }

  const stored = loadMacroView(provider);
  if (stored) {
    return {
      data: stored.data,
      error: null,
      cachedAt: stored.updatedAt,
      stale: stored.stale,
      source: "store",
    };
  }

  return {
    data: null,
    error: null,
    cachedAt: null,
    stale: false,
    source: "empty",
  };
}

export function getRefreshMetaPayload(refreshInProgress = false): RefreshMetaPayload {
  const meta = loadMeta();
  return {
    lastFullRefresh: meta.lastFullRefresh,
    lastQuoteRefresh: meta.lastQuoteRefresh,
    refreshInProgress,
  };
}

export function warmDashboardCaches(): void {
  const indices = loadIndices("us");
  if (indices) cache.set("market:indices:us", indices.data, TTL.INDICES);

  const fearGreed = loadFearGreed();
  if (fearGreed) cache.set("fear-greed", fearGreed.data, TTL.FEAR_GREED);

  const macroView = loadMacroView();
  if (macroView) cache.set("macro:view:gemini", macroView.data, TTL.MACRO_VIEW);
}
