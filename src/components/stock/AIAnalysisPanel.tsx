"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, AlertTriangle, Sparkles, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, RecommendationBadge } from "@/components/ui/Badge";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { formatDistanceToNow, parseISO } from "date-fns";
import type { AIAnalysis } from "@/lib/types";

interface Props {
  symbol: string;
}

function AnalysisSection({
  icon,
  title,
  items,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  color: string;
}) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-elevated/30 p-3">
      <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${color}`}>
        {icon}
        {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
            <span className={`mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${color.replace("text-", "bg-")}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AIAnalysisPanel({ symbol }: Props) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalysis = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/stock/${symbol}/analysis`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setAnalysis(json.data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <CardTitle>AI Analysis</CardTitle>
        </div>
        <button
          onClick={fetchAnalysis}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-neutral hover:bg-surface-elevated hover:text-slate-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </CardHeader>

      {loading && (
        <div className="flex flex-col items-center justify-center gap-2 py-10">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-neutral">Generating AI analysis…</p>
          <p className="text-xs text-neutral/60">This may take a few seconds</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-bear/30 bg-bear/10 p-3 text-sm text-bear">
          {error}
        </div>
      )}

      {!loading && analysis && (
        <div className="space-y-3">
          {/* Recommendation banner */}
          <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-elevated p-3">
            <div>
              <p className="text-xs font-medium text-neutral">Recommendation</p>
              <div className="mt-1 flex items-center gap-2">
                <RecommendationBadge rec={analysis.recommendation} />
                <Badge variant="neutral" size="sm">
                  Confidence: {analysis.confidence}
                </Badge>
              </div>
            </div>
            {analysis.generatedAt && (
              <p className="text-xs text-neutral/60">
                {formatDistanceToNow(parseISO(analysis.generatedAt), { addSuffix: true })}
              </p>
            )}
          </div>

          {/* Summary */}
          <p className="text-sm leading-relaxed text-slate-300">{analysis.summary}</p>

          {/* Entry / Stop */}
          {(analysis.targetEntry || analysis.stopLoss) && (
            <div className="grid grid-cols-2 gap-2">
              {analysis.targetEntry && (
                <div className="rounded-lg border border-bull/20 bg-bull/5 p-2 text-center">
                  <p className="text-xs text-neutral">Target Entry</p>
                  <p className="font-mono text-sm font-bold text-bull">{analysis.targetEntry}</p>
                </div>
              )}
              {analysis.stopLoss && (
                <div className="rounded-lg border border-bear/20 bg-bear/5 p-2 text-center">
                  <p className="text-xs text-neutral">Stop Loss</p>
                  <p className="font-mono text-sm font-bold text-bear">{analysis.stopLoss}</p>
                </div>
              )}
            </div>
          )}

          {/* Bull / Bear / Risks */}
          <AnalysisSection
            icon={<TrendingUp className="h-4 w-4" />}
            title="Bull Case"
            items={analysis.bullCase}
            color="text-bull"
          />
          <AnalysisSection
            icon={<TrendingDown className="h-4 w-4" />}
            title="Bear Case"
            items={analysis.bearCase}
            color="text-bear"
          />
          <AnalysisSection
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Key Risks"
            items={analysis.risks}
            color="text-warn"
          />

          <p className="text-[11px] text-neutral/50">
            AI-generated analysis is for informational purposes only and does not constitute financial advice.
          </p>
        </div>
      )}
    </Card>
  );
}
