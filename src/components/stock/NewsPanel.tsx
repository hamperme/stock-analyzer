"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Clock } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, NewsSentimentBadge } from "@/components/ui/Badge";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import type { NewsItem, NewsTag } from "@/lib/types";

const tagVariants: Record<NewsTag, "bull" | "bear" | "warn" | "accent" | "neutral"> = {
  Earnings: "warn",
  "Product Launch": "accent",
  Legal: "bear",
  Partnership: "bull",
  "Analyst Rating": "accent",
  "Executive Change": "neutral",
  "Market Sentiment": "neutral",
  General: "neutral",
};

function TimeAgo({ iso }: { iso: string }) {
  try {
    return (
      <span className="flex items-center gap-1 text-xs text-neutral">
        <Clock className="h-3 w-3" />
        {formatDistanceToNow(parseISO(iso), { addSuffix: true })}
      </span>
    );
  } catch {
    return null;
  }
}

export function NewsPanel({ symbol }: { symbol: string }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stock/${symbol}/news`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setNews(json.data ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest News</CardTitle>
        <span className="text-xs text-neutral">{news.length} articles</span>
      </CardHeader>

      {loading && (
        <div className="flex justify-center py-8">
          <LoadingSpinner label="Loading news…" />
        </div>
      )}

      {error && (
        <p className="py-4 text-center text-sm text-bear">{error}</p>
      )}

      {!loading && !error && news.length === 0 && (
        <p className="py-4 text-center text-sm text-neutral">No recent news found.</p>
      )}

      {!loading && !error && (
        <div className="space-y-3">
          {news.map((item, i) => (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-surface-border bg-surface-elevated/30 p-3 transition-colors hover:bg-surface-elevated hover:border-surface-border"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge variant={tagVariants[item.tag]}>{item.tag}</Badge>
                <NewsSentimentBadge sentiment={item.sentiment} />
                <span className="text-xs text-neutral">{item.publisher}</span>
                <TimeAgo iso={item.publishedAt} />
                <ExternalLink className="ml-auto h-3.5 w-3.5 text-neutral/50" />
              </div>
              <p className="text-sm font-medium leading-snug text-slate-200 line-clamp-2">
                {item.title}
              </p>
              {item.summary && (
                <p className="mt-1.5 text-xs leading-relaxed text-neutral line-clamp-2">
                  {item.summary}
                </p>
              )}
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}
