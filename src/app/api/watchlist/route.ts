/**
 * GET /api/watchlist
 * POST /api/watchlist
 * DELETE /api/watchlist
 *
 * Snapshot-first watchlist data plus persistent symbol management.
 */

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getWatchlistPayload } from "@/lib/dashboard-data";
import { getWatchlistSymbols, rebuildWatchlistSnapshot, refreshSymbolData } from "@/lib/refresh";
import { saveWatchlistSymbols } from "@/lib/store";

export const dynamic = "force-dynamic";

function buildWatchlistResponse() {
  return NextResponse.json(getWatchlistPayload());
}

export async function GET() {
  return buildWatchlistResponse();
}

export async function POST(req: Request) {
  let symbol: string;
  try {
    const body = await req.json();
    symbol = String(body?.symbol ?? "").trim().toUpperCase();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!symbol) {
    return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
  }

  const currentSymbols = getWatchlistSymbols();
  if (currentSymbols.includes(symbol)) {
    return buildWatchlistResponse();
  }

  const result = await refreshSymbolData(symbol);
  if (!result.quote) {
    const firstError = result.errors[0] ?? `Unable to add ${symbol}`;
    return NextResponse.json(
      { error: firstError.replace(/^quote:\s*/i, "") },
      { status: 400 }
    );
  }

  saveWatchlistSymbols([...currentSymbols, symbol]);
  rebuildWatchlistSnapshot();
  revalidatePath("/");

  return NextResponse.json({
    ...getWatchlistPayload(),
    added: symbol,
    refresh: result,
  });
}

export async function DELETE(req: Request) {
  let symbol: string;
  try {
    const body = await req.json();
    symbol = String(body?.symbol ?? "").trim().toUpperCase();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!symbol) {
    return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
  }

  const nextSymbols = getWatchlistSymbols().filter((item) => item !== symbol);
  saveWatchlistSymbols(nextSymbols);
  rebuildWatchlistSnapshot(nextSymbols);
  revalidatePath("/");

  return NextResponse.json({
    ...getWatchlistPayload(),
    removed: symbol,
  });
}
