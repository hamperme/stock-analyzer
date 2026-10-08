import type { DerivativesSnapshot } from "./types";
import type { HistoricalBar } from "./types";

const BASE = "https://fapi.binance.com";

function exchangeSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper.endsWith("-USD")) return `${upper.slice(0, -4)}USDT`;
  if (upper.endsWith("-USDT")) return `${upper.slice(0, -5)}USDT`;
  return upper.replace(/[^A-Z0-9]/g, "");
}

async function getJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

type Premium = { markPrice: string; indexPrice: string; lastFundingRate: string; nextFundingTime: number };
type OI = { openInterest: string };
type OIHist = { sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number };
type Funding = { fundingRate: string; fundingTime: number };
type Ratio = { longAccount: string; shortAccount: string; longShortRatio: string; timestamp: number };
type Taker = { buySellRatio: string; timestamp: number };

export async function getDerivativesSnapshot(symbol: string): Promise<DerivativesSnapshot> {
  const pair = exchangeSymbol(symbol);
  const q = `symbol=${encodeURIComponent(pair)}`;
  const [premium, oi, oiHistory, fundingHistory, ratios, taker] = await Promise.all([
    getJson<Premium>(`/fapi/v1/premiumIndex?${q}`),
    getJson<OI>(`/fapi/v1/openInterest?${q}`),
    getJson<OIHist[]>(`/futures/data/openInterestHist?${q}&period=30m&limit=49`),
    getJson<Funding[]>(`/fapi/v1/fundingRate?${q}&limit=24`),
    getJson<Ratio[]>(`/futures/data/globalLongShortAccountRatio?${q}&period=5m&limit=1`),
    getJson<Taker[]>(`/futures/data/takerlongshortRatio?${q}&period=5m&limit=1`),
  ]);

  const markPrice = Number(premium.markPrice);
  const indexPrice = Number(premium.indexPrice);
  const fundingRate = Number(premium.lastFundingRate);
  const latestOiValue = oiHistory.at(-1)?.sumOpenInterestValue;
  const firstOiValue = Number(oiHistory[0]?.sumOpenInterestValue);
  const lastOiValue = Number(latestOiValue);
  const ratio = ratios.at(-1);

  return {
    symbol: symbol.toUpperCase(),
    exchangeSymbol: pair,
    markPrice,
    indexPrice,
    basisPct: indexPrice ? ((markPrice - indexPrice) / indexPrice) * 100 : 0,
    fundingRate,
    fundingAnnualizedPct: fundingRate * 3 * 365 * 100,
    nextFundingTime: premium.nextFundingTime,
    openInterest: Number(oi.openInterest),
    openInterestUsd: Number.isFinite(lastOiValue) ? lastOiValue : Number(oi.openInterest) * markPrice,
    openInterestChange24hPct: firstOiValue > 0 && Number.isFinite(lastOiValue)
      ? ((lastOiValue - firstOiValue) / firstOiValue) * 100
      : null,
    longAccountPct: ratio ? Number(ratio.longAccount) * 100 : null,
    shortAccountPct: ratio ? Number(ratio.shortAccount) * 100 : null,
    longShortRatio: ratio ? Number(ratio.longShortRatio) : null,
    takerBuySellRatio: taker.at(-1) ? Number(taker.at(-1)!.buySellRatio) : null,
    oiHistory: oiHistory.map((p) => ({ time: p.timestamp, value: Number(p.sumOpenInterestValue) })),
    fundingHistory: fundingHistory.map((p) => ({ time: p.fundingTime, value: Number(p.fundingRate) })),
    updatedAt: new Date().toISOString(),
    source: "binance-usdm",
  };
}

export async function getFuturesKlines(
  symbol: string,
  interval: "1m" | "5m" | "15m" | "1h" | "4h",
  limit = 1000
): Promise<HistoricalBar[]> {
  const pair = exchangeSymbol(symbol);
  type Kline = [number, string, string, string, string, string, number, ...unknown[]];
  const rows = await getJson<Kline[]>(`/fapi/v1/klines?symbol=${encodeURIComponent(pair)}&interval=${interval}&limit=${Math.min(1500, limit)}`);
  return rows.map((k) => ({
    date: new Date(k[0]).toISOString(),
    open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
  })).filter((b) => b.close > 0);
}
