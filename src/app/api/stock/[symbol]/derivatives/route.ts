import { NextResponse } from "next/server";
import { getDerivativesSnapshot } from "@/lib/binance-futures";
import { cache, TTL } from "@/lib/cache";
import { loadDerivatives, saveDerivatives } from "@/lib/store";
import type { DerivativesSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const key = `derivatives:${symbol}`;
  const cached = cache.get<DerivativesSnapshot>(key);
  if (cached) return NextResponse.json({ data: cached, stale: false, source: "cache" });

  try {
    const data = await getDerivativesSnapshot(symbol);
    cache.set(key, data, TTL.DERIVATIVES);
    saveDerivatives(symbol, data);
    return NextResponse.json({ data, stale: false, source: data.source });
  } catch (error) {
    const stored = loadDerivatives(symbol);
    if (stored) {
      return NextResponse.json({ data: stored.data, stale: true, source: "store", warning: (error as Error).message });
    }
    return NextResponse.json({ data: null, error: (error as Error).message }, { status: 502 });
  }
}
