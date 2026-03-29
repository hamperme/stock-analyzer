import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
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
  const price = quote.price;
  const na = "—";
  const rsiColor =
    indicators.rsi > 70 ? "text-bear" : indicators.rsi < 30 ? "text-warn" : "text-bull";
  const regimeColor = indicators.trendRegime.includes("Up")
    ? "text-bull"
    : indicators.trendRegime === "Sideways"
    ? "text-warn"
    : "text-bear";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Technical Indicators</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral">Score</span>
          <span className="font-mono text-sm font-bold text-slate-200">{indicators.setupScore}/100</span>
        </div>
      </CardHeader>

      {/* Banner when indicators are defaults, not computed */}
      {!hasHistory && (
        <div className="mb-3 rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-xs text-warn/80">
          Historical data temporarily unavailable — indicators are estimates only.
        </div>
      )}

      {/* Setup Score Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-neutral mb-1">
          <span>Setup Quality</span>
          <Badge variant={indicators.setupLabel === "Strong Setup" ? "strong" : indicators.setupLabel === "Watch" ? "watch" : indicators.setupLabel === "Avoid" ? "avoid" : "neutral"}>
            {indicators.setupLabel}
          </Badge>
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
              {indicators.rsi > 70 ? "Overbought" : indicators.rsi < 30 ? "Oversold" : "Healthy"}
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
        <Metric label="Trend Regime" value={indicators.trendRegime} color={regimeColor} />
        <Metric label="Relative Volume" value={`${indicators.relativeVolume.toFixed(2)}x`}
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
        <Metric label="52w High" value={hasHistory ? `$${indicators.high52w.toFixed(2)}` : na} />
        <Metric label="52w Low" value={hasHistory ? `$${indicators.low52w.toFixed(2)}` : na} />
        <Metric label="From 52w High"
          value={hasHistory ? `${indicators.distFrom52wHighPct.toFixed(1)}%` : na}
          color={hasHistory ? (indicators.distFrom52wHighPct > -10 ? "text-bull" : "text-bear") : "text-neutral/50"} />
        {quote.beta && (
          <Metric label="Beta" value={quote.beta.toFixed(2)} />
        )}
        {quote.marketCap && (
          <Metric
            label="Market Cap"
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
