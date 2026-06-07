"use client";

import { useSettings } from "@/components/app/SettingsProvider";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { SetupBadge } from "@/components/ui/Badge";
import { getAssetType } from "@/lib/assets";
import type { TechnicalIndicators, StockQuote } from "@/lib/types";

interface Props {
  indicators: TechnicalIndicators;
  quote: StockQuote;
  hasHistory?: boolean;
}

function Metric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-surface-border last:border-0">
      <span className="text-sm text-neutral">{label}</span>
      <div className="text-right">
        <span className={`font-mono text-sm font-semibold ${color ?? "text-slate-200"}`}>
          {value}
        </span>
        {sub && <span className="ml-1 text-xs text-neutral">{sub}</span>}
      </div>
    </div>
  );
}

function RSIBar({ rsi }: { rsi: number }) {
  const color = rsi > 70 ? "bg-bear" : rsi < 30 ? "bg-warn" : "bg-bull";
  return (
    <div className="mt-1 h-1.5 w-full rounded-full bg-surface-elevated">
      <div
        className={`h-full rounded-full ${color} transition-all`}
        style={{ width: `${rsi}%` }}
      />
    </div>
  );
}

function SetupScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-bull" : score >= 60 ? "bg-warn" : score >= 40 ? "bg-neutral" : "bg-bear";
  return (
    <div className="mt-1 h-2 w-full rounded-full bg-surface-elevated">
      <div
        className={`h-full rounded-full ${color} transition-all`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

export function TechnicalPanel({ indicators, quote, hasHistory = true }: Props) {
  const { dict } = useSettings();
  const price = quote.price;
  const assetType = quote.assetType ?? getAssetType(quote.symbol);
  const na = "—";
  const rsiColor =
    indicators.rsi > 70 ? "text-bear" : indicators.rsi < 30 ? "text-warn" : "text-bull";
  const regimeColor = indicators.trendRegime.includes("Up")
    ? "text-bull"
    : indicators.trendRegime === "Sideways"
    ? "text-warn"
    : "text-bear";
  const rsiState =
    indicators.rsi > 70 ? dict.technical.overbought : indicators.rsi < 30 ? dict.technical.oversold : dict.technical.healthy;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.technical.title}</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral">{dict.technical.score}</span>
          <span className="font-mono text-sm font-bold text-slate-200">{indicators.setupScore}/100</span>
        </div>
      </CardHeader>

      {/* Banner when indicators are defaults, not computed */}
      {!hasHistory && (
        <div className="mb-3 rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-xs text-warn/80">
          {dict.technical.estimatesOnly}
        </div>
      )}

      {/* Setup Score Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-neutral mb-1">
          <span>{dict.technical.setupQuality}</span>
          <SetupBadge
            label={indicators.setupLabel}
            displayLabel={dict.watchlist.setupLabels[indicators.setupLabel]}
          />
        </div>
        <SetupScoreBar score={indicators.setupScore} />
      </div>

      {/* RSI */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-neutral mb-1">
          <span>RSI (14)</span>
          <span className={`font-mono font-bold ${rsiColor}`}>
            {indicators.rsi.toFixed(1)}
            <span className="ml-1 text-neutral font-normal">
              {rsiState}
            </span>
          </span>
        </div>
        <RSIBar rsi={indicators.rsi} />
        <div className="flex justify-between mt-0.5 text-[10px] text-neutral/60">
          <span>0 Oversold</span>
          <span>30</span>
          <span>70</span>
          <span>Overbought 100</span>
        </div>
      </div>

      {/* Trend + MAs */}
      <div className="space-y-0">
        <Metric
          label={dict.technical.trendRegime}
          value={dict.technical.trendLabels[indicators.trendRegime]}
          color={regimeColor}
        />
        <Metric label={dict.technical.relativeVolume} value={`${indicators.relativeVolume.toFixed(2)}x`}
          color={indicators.relativeVolume >= 1.5 ? "text-accent" : "text-slate-400"} />
        <Metric label="MA20" value={`$${indicators.ma20.toFixed(2)}`}
          sub={price > indicators.ma20 ? "▲ above" : "▼ below"}
          color={price > indicators.ma20 ? "text-bull" : "text-bear"} />
        <Metric label="MA50" value={`$${indicators.ma50.toFixed(2)}`}
          sub={`${indicators.priceVsMa50Pct > 0 ? "+" : ""}${indicators.priceVsMa50Pct.toFixed(1)}%`}
          color={indicators.priceVsMa50Pct >= 0 ? "text-bull" : "text-bear"} />
        <Metric label="MA200" value={`$${indicators.ma200.toFixed(2)}`}
          sub={`${indicators.priceVsMa200Pct > 0 ? "+" : ""}${indicators.priceVsMa200Pct.toFixed(1)}%`}
          color={indicators.priceVsMa200Pct >= 0 ? "text-bull" : "text-bear"} />
        <Metric label={dict.technical.high52w} value={hasHistory ? `$${indicators.high52w.toFixed(2)}` : na} />
        <Metric label={dict.technical.low52w} value={hasHistory ? `$${indicators.low52w.toFixed(2)}` : na} />
        <Metric label={dict.technical.from52wHigh}
          value={hasHistory ? `${indicators.distFrom52wHighPct.toFixed(1)}%` : na}
          color={hasHistory ? (indicators.distFrom52wHighPct > -10 ? "text-bull" : "text-bear") : "text-neutral/50"} />
        {assetType === "stock" && quote.beta && (
          <Metric label={dict.technical.beta} value={quote.beta.toFixed(2)} />
        )}
        {assetType === "stock" && quote.marketCap && (
          <Metric
            label={dict.technical.marketCap}
            value={
              quote.marketCap >= 1e12
                ? `$${(quote.marketCap / 1e12).toFixed(2)}T`
                : quote.marketCap >= 1e9
                ? `$${(quote.marketCap / 1e9).toFixed(1)}B`
                : `$${(quote.marketCap / 1e6).toFixed(0)}M`
            }
          />
        )}
      </div>
    </Card>
  );
}
