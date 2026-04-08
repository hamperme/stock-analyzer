import { MarketIndices } from "@/components/dashboard/MarketIndices";
import { FearGreedCard } from "@/components/dashboard/FearGreedCard";
import { MacroViewPanel } from "@/components/dashboard/MacroViewPanel";
import { WatchlistTable } from "@/components/dashboard/WatchlistTable";
import { RefreshButton } from "@/components/dashboard/RefreshButton";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Market Dashboard</h1>
          <p className="mt-1 text-sm text-neutral">
            Real-time watchlist with technical analysis and market sentiment
          </p>
        </div>
        <RefreshButton />
      </div>

      {/* Market Indices + Fear & Greed */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <MarketIndices />
        </div>
        <div className="lg:col-span-1">
          <FearGreedCard />
        </div>
      </div>

      {/* Bull vs Bear Macro View */}
      <MacroViewPanel />

      {/* Watchlist */}
      <WatchlistTable />

      {/* Disclaimer */}
      <p className="text-xs text-neutral/50">
        Market data provided by Finnhub &amp; Yahoo Finance. Prices may be delayed up to 15 minutes.
        Technical indicators are calculated from historical data and do not guarantee future performance.
        Data is cached and may be stale — use the refresh button to pull fresh data.
      </p>
    </div>
  );
}
