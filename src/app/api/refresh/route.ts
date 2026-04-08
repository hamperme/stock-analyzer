/**
 * POST /api/refresh — trigger a batch data refresh.
 * GET  /api/refresh — check refresh status / last refresh time.
 *
 * Query params (POST):
 *   ?type=full    — full refresh (quotes + history + news) [default]
 *   ?type=quotes  — quick quote-only refresh
 *   ?symbols=AAPL,MSFT — override which symbols to refresh
 */

import { NextResponse } from "next/server";
import { runFullRefresh, runQuoteRefresh } from "@/lib/refresh";
import { loadMeta } from "@/lib/store";

// Prevent concurrent refreshes
let refreshInProgress = false;

export async function POST(req: Request) {
  if (refreshInProgress) {
    return NextResponse.json(
      { error: "A refresh is already in progress. Please wait." },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "full";
  const symbolsParam = searchParams.get("symbols");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  refreshInProgress = true;
  try {
    if (type === "quotes") {
      const result = await runQuoteRefresh(symbols);
      return NextResponse.json({ data: result, error: null });
    }

    const skipHistory = type === "quotes";
    const skipNews = type === "quotes";
    const result = await runFullRefresh({ symbols, skipHistory, skipNews });
    return NextResponse.json({ data: result, error: null });
  } catch (err) {
    console.error("[refresh]", err);
    return NextResponse.json(
      { data: null, error: `Refresh failed: ${(err as Error).message}` },
      { status: 500 }
    );
  } finally {
    refreshInProgress = false;
  }
}

export async function GET() {
  const meta = loadMeta();
  return NextResponse.json({
    data: {
      ...meta,
      refreshInProgress,
    },
    error: null,
  });
}
