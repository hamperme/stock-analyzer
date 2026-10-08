import { NextResponse } from "next/server";
import { getOptionsSnapshot } from "@/lib/cboe-options";
import { cache, TTL } from "@/lib/cache";
import { loadOptions, saveOptions } from "@/lib/store";
import type { OptionsSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const key = `options:${symbol}`;
  const cached = cache.get<OptionsSnapshot>(key);
  if (cached) return NextResponse.json({ data: cached, stale: false, source: "cache" });
  try {
    const data = await getOptionsSnapshot(symbol);
    cache.set(key, data, TTL.OPTIONS);
    saveOptions(symbol, data);
    return NextResponse.json({ data, stale: false, source: data.source });
  } catch (error) {
    const stored = loadOptions(symbol);
    if (stored) return NextResponse.json({ data: stored.data, stale: true, source: "store", warning: (error as Error).message });
    return NextResponse.json({ data: null, error: (error as Error).message }, { status: 502 });
  }
}
