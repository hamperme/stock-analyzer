"use client";

import { useState, useEffect } from "react";
import { RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { useSettings } from "@/components/app/SettingsProvider";
import { formatStableLocalDateTime } from "@/lib/time";

interface RefreshMeta {
  lastFullRefresh: string | null;
  lastQuoteRefresh: string | null;
  refreshInProgress: boolean;
}

interface RefreshButtonProps {
  initialMeta?: RefreshMeta | null;
}

export function RefreshButton({ initialMeta }: RefreshButtonProps) {
  const { dict } = useSettings();
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [meta, setMeta] = useState<RefreshMeta | null>(initialMeta ?? null);
  const [message, setMessage] = useState("");

  // Load refresh status on mount
  useEffect(() => {
    fetch("/api/refresh")
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setMeta(json.data);
      })
      .catch(() => {});
  }, []);

  const handleRefresh = async (type: "full" | "quotes") => {
    setRefreshing(true);
    setStatus("idle");
    setMessage(type === "full" ? dict.refreshButton.refreshingAll : dict.refreshButton.updatingQuotes);

    try {
      const res = await fetch(`/api/refresh?type=${type}`, { method: "POST" });
      const json = await res.json();
      if (json.error) {
        setStatus("error");
        setMessage(json.error);
      } else {
        setStatus("success");
        const result = json.data;
        if (type === "full") {
          setMessage(
            dict.refreshButton.refreshedSymbols(
              result.symbols?.length ?? 0,
              Math.round((result.durationMs ?? 0) / 1000),
              result.totalErrors ?? 0
            )
          );
        } else {
          setMessage(dict.refreshButton.updatedQuotes(result.updated?.length ?? 0));
        }
        // Reload the page data after a short delay
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const lastRefresh = meta?.lastFullRefresh
    ? formatStableLocalDateTime(meta.lastFullRefresh)
    : dict.common.never;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleRefresh("quotes")}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface px-3 py-1.5 text-xs font-medium text-neutral hover:bg-surface-elevated hover:text-slate-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {dict.refreshButton.quickUpdate}
        </button>
        <button
          onClick={() => handleRefresh("full")}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {dict.refreshButton.fullRefresh}
        </button>
      </div>

      {/* Status message */}
      {message && (
        <div className={`flex items-center gap-1 text-xs ${
          status === "success" ? "text-bull" :
          status === "error" ? "text-bear" :
          "text-neutral"
        }`}>
          {status === "success" && <CheckCircle className="h-3 w-3" />}
          {status === "error" && <AlertCircle className="h-3 w-3" />}
          {refreshing && <RefreshCw className="h-3 w-3 animate-spin" />}
          {message}
        </div>
      )}

      {/* Last refresh time */}
      <p className="text-[10px] text-neutral/50">
        {dict.refreshButton.lastFullRefresh(lastRefresh)}
      </p>
    </div>
  );
}
