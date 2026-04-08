/**
 * GET /api/indices
 *
 * Snapshot-first: returns indices from SQLite store.
 * Falls back to live Yahoo fetch only if store is completely empty.
 * Indices are 4 lightweight requests so one-time seeding is acceptable.
 */

import { NextResponse } from "next/server";
import https from "https";
import { cache, TTL } from "@/lib/cache";
import { loadIndices, saveIndices } from "@/lib/store";
import type { MarketIndex } from "@/lib/types";

const INDEX_SYMBOLS: Array<{ symbol: string; name: string }> = [
  { symbol: "^GSPC", name: "S&P 500" },
  { symbol: "^DJI",  name: "Dow Jones" },
  { symbol: "^IXIC", name: "Nasdaq" },
  { symbol: "^RUT",  name: "Russell 2000" },
];

function httpsGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      timeout: 10_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error("Bad JSON")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

async function fetchIndex(symbol: string, name: string): Promise<MarketIndex> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await httpsGet(url)) as any;
  const meta = json?.chart?.result?.[0]?.meta ?? {};
  const price: number = meta.regularMarketPrice ?? 0;
  const prevClose: number = meta.chartPreviousClose ?? price;
  const change = Math.round((price - prevClose) * 100) / 100;
  const changePercent = prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;
  return { symbol, name, price, change, changePercent };
}

export async function GET() {
  // 1. In-memory cache
  const cacheKey = "market:indices";
  const memCached = cache.get<MarketIndex[]>(cacheKey);
  if (memCached) return NextResponse.json({ data: memCached, error: null, source: "cache" });

  // 2. SQLite store
  const stored = loadIndices();
  if (stored && stored.data.length > 0) {
    cache.set(cacheKey, stored.data, TTL.INDICES);
    return NextResponse.json({
      data: stored.data,
      error: null,
      cachedAt: stored.updatedAt,
      stale: stored.stale,
      source: "store",
    });
  }

  // 3. Seed fetch — indices are just 4 Yahoo requests, acceptable for first load
  try {
    const results = await Promise.allSettled(
      INDEX_SYMBOLS.map(({ symbol, name }) => fetchIndex(symbol, name))
    );
    const indices = results
      .filter((r): r is PromiseFulfilledResult<MarketIndex> => r.status === "fulfilled")
      .map((r) => r.value);

    cache.set(cacheKey, indices, TTL.INDICES);
    if (indices.length > 0) saveIndices(indices);

    return NextResponse.json({ data: indices, error: null, source: "live-seed" });
  } catch (err) {
    console.error("[indices]", err);
    return NextResponse.json({
      data: [],
      error: "Failed to fetch indices — run Full Refresh.",
      source: "empty",
    });
  }
}
