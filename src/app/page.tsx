import { cookies } from "next/headers";
import { MarketIndices } from "@/components/dashboard/MarketIndices";
import { FearGreedCard } from "@/components/dashboard/FearGreedCard";
import { MacroViewPanel } from "@/components/dashboard/MacroViewPanel";
import { WatchlistTable } from "@/components/dashboard/WatchlistTable";
import { RefreshButton } from "@/components/dashboard/RefreshButton";
import { readAppSettings } from "@/lib/app-settings";
import { getAvailableAiProviders } from "@/lib/ai-provider-server";
import {
  getInitialFearGreedPayload,
  getInitialIndicesPayload,
  getInitialMacroViewPayload,
  getRefreshMetaPayload,
  getWatchlistPayload,
} from "@/lib/dashboard-data";
import { getDictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const { locale, aiProvider, market } = readAppSettings(cookies(), getAvailableAiProviders());
  const dict = getDictionary(locale);
  const indices = getInitialIndicesPayload(market);
  const fearGreed = getInitialFearGreedPayload();
  const macroView = getInitialMacroViewPayload(aiProvider);
  const watchlist = getWatchlistPayload();
  const refreshMeta = getRefreshMetaPayload();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{dict.dashboard.title}</h1>
          <p className="mt-1 text-sm text-neutral">
            {dict.dashboard.subtitle}
          </p>
        </div>
        <RefreshButton initialMeta={refreshMeta} />
      </div>

      {/* Market Indices + Fear & Greed */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <MarketIndices
            initialData={indices.data}
            initialError={indices.error}
            initialLastUpdated={indices.cachedAt ?? undefined}
            initialMarket={market}
          />
        </div>
        <div className="lg:col-span-1">
          <FearGreedCard
            initialData={fearGreed.data ?? undefined}
            initialError={fearGreed.error ?? undefined}
          />
        </div>
      </div>

      {/* Bull vs Bear Macro View */}
      <MacroViewPanel
        initialData={macroView.data ?? undefined}
        initialError={macroView.error ?? undefined}
        initialLastUpdated={macroView.cachedAt ?? undefined}
      />

      {/* Watchlist */}
      <WatchlistTable
        initialData={watchlist.data}
        initialSymbols={watchlist.symbols}
        initialError={watchlist.error}
        initialStale={watchlist.stale}
        initialCachedAt={watchlist.cachedAt ?? undefined}
      />

      {/* Disclaimer */}
      <p className="text-xs text-neutral/50">
        {dict.dashboard.disclaimer}
      </p>
    </div>
  );
}
