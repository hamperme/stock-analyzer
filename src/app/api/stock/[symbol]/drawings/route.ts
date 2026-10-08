import { NextResponse } from "next/server";
import {
  CHART_DRAWING_TOOL_CONTRACT,
  normalizeChartDrawing,
  normalizeChartDrawings,
} from "@/lib/chart-drawings";
import { loadChartDrawings, saveChartDrawings } from "@/lib/store";
import type { ChartDrawing } from "@/lib/types";

export const dynamic = "force-dynamic";

function context(req: Request, symbolParam: string) {
  const url = new URL(req.url);
  return {
    url,
    symbol: symbolParam.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 24),
    interval: (url.searchParams.get("interval") ?? "1d").toLowerCase().slice(0, 8),
  };
}

function current(symbol: string, interval: string): ChartDrawing[] {
  return loadChartDrawings(symbol, interval)?.data ?? [];
}

function response(symbol: string, interval: string, drawings: ChartDrawing[]) {
  return NextResponse.json({
    data: drawings,
    symbol,
    interval,
    count: drawings.length,
    updatedAt: loadChartDrawings(symbol, interval)?.updatedAt ?? null,
  });
}

function badRequest(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid drawing request" }, { status: 400 });
}

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  const { url, symbol, interval } = context(req, params.symbol);
  if (url.searchParams.get("schema") === "1") {
    return NextResponse.json({ tool: CHART_DRAWING_TOOL_CONTRACT });
  }
  return response(symbol, interval, current(symbol, interval));
}

/** Upsert one or more drawings by stable id. */
export async function POST(req: Request, { params }: { params: { symbol: string } }) {
  const { symbol, interval } = context(req, params.symbol);
  try {
    const body = await req.json() as { drawing?: unknown; drawings?: unknown };
    const incoming = body.drawings !== undefined
      ? normalizeChartDrawings(body.drawings)
      : [normalizeChartDrawing(body.drawing)];
    const merged = new Map(current(symbol, interval).map((drawing) => [drawing.id, drawing]));
    incoming.forEach((drawing) => merged.set(drawing.id, drawing));
    const drawings = normalizeChartDrawings(Array.from(merged.values()));
    saveChartDrawings(symbol, interval, drawings);
    return response(symbol, interval, drawings);
  } catch (error) {
    return badRequest(error);
  }
}

/** Atomically replace the full drawing layer. */
export async function PUT(req: Request, { params }: { params: { symbol: string } }) {
  const { symbol, interval } = context(req, params.symbol);
  try {
    const body = await req.json() as { drawings?: unknown };
    const drawings = normalizeChartDrawings(body.drawings);
    saveChartDrawings(symbol, interval, drawings);
    return response(symbol, interval, drawings);
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(req: Request, { params }: { params: { symbol: string } }) {
  const { url, symbol, interval } = context(req, params.symbol);
  const id = url.searchParams.get("id");
  const clearAll = url.searchParams.get("all") === "1";
  if (!id && !clearAll) return badRequest(new Error("Provide id={DRAWING_ID} or all=1"));
  const drawings = clearAll ? [] : current(symbol, interval).filter((drawing) => drawing.id !== id);
  saveChartDrawings(symbol, interval, drawings);
  return response(symbol, interval, drawings);
}
