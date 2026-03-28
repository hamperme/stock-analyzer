import { NextResponse } from "next/server";
import { cache, TTL } from "@/lib/cache";
import type { MarketIndex } from "@/lib/types";

const INDEX_SYMBOLS: Array<{ symbol: string; name: string }> = [
  { symbol: "^GSPC", name: "S&P 500" },
  { symbol: "^DJI", name: "Dow Jones" },
  { symbol: "^IXIC", name: "Nasdaq" },
  { symbol: "^RUT", name: "Russell 2000" },
];

async function fetchIndex(symbol: string, name: string): Promise<MarketIndex> {
  const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(
    symbol
  )}?modules=price`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  const p = json?.quoteSummary?.result?.[0]?.price ?? {};

  return {
    symbol,
    name,
    price: p.regularMarketPrice?.raw ?? 0,
    change: p.regularMarketChange?.raw ?? 0,
    changePercent: (p.regularMarketChangePercent?.raw ?? 0) * 100,
  };
}

export async function GET() {
  const cacheKey = "market:indices";
  const cached = cache.get<MarketIndex[]>(cacheKey);
  if (cached) return NextResponse.json({ data: cached, error: null });

  try {
    const results = await Promise.allSettled(
      INDEX_SYMBOLS.map(({ symbol, name }) => fetchIndex(symbol, name))
    );

    const indices = results
      .filter((r): r is PromiseFulfilledResult<MarketIndex> => r.status === "fulfilled")
      .map((r) => r.value);

    cache.set(cacheKey, indices, TTL.INDICES);
    return NextResponse.json({ data: indices, error: null });
  } catch (err) {
    console.error("[indices]", err);
    return NextResponse.json(
      { data: null, error: "Failed to fetch market indices" },
      { status: 500 }
    );
  }
}
