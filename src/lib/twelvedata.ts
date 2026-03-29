/**
 * Twelve Data historical data client (fallback when Yahoo Finance rate-limits).
 * Free tier: 800 API calls/day, 8/minute — sufficient for watchlist use.
 * Get a free key (no credit card) at https://twelvedata.com/pricing
 */

import https from "https";
import { cache, TTL } from "./cache";
import type { HistoricalBar } from "./types";

function getKey(): string | null {
  return process.env.TWELVEDATA_API_KEY ?? null;
}

function httpsGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      timeout: 12_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Twelve Data HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("Twelve Data returned invalid JSON")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Twelve Data request timed out")); });
  });
}

export async function getHistoricalData(
  symbol: string,
  days = 365
): Promise<HistoricalBar[]> {
  const key = getKey();
  if (!key) throw new Error("TWELVEDATA_API_KEY not set");

  const cacheKey = `td:history:${symbol}:${days}`;
  const cached = cache.get<HistoricalBar[]>(cacheKey);
  if (cached) return cached;

  const outputsize = Math.min(days, 500);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}&apikey=${key}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await httpsGet(url)) as any;

  if (raw.status === "error") {
    throw new Error(`Twelve Data error for ${symbol}: ${raw.message}`);
  }

  const values: Array<{
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }> = raw.values ?? [];

  if (!values.length) throw new Error(`No Twelve Data history for ${symbol}`);

  // Twelve Data returns newest-first; reverse to oldest-first
  const bars: HistoricalBar[] = values
    .reverse()
    .map((v) => ({
      date:   v.datetime,
      open:   parseFloat(v.open),
      high:   parseFloat(v.high),
      low:    parseFloat(v.low),
      close:  parseFloat(v.close),
      volume: parseInt(v.volume, 10) || 0,
    }))
    .filter((b) => b.close > 0);

  cache.set(cacheKey, bars, TTL.HISTORY);
  return bars;
}
