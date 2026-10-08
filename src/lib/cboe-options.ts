import type { OptionsSnapshot, UnusualOption, OptionExpiryAnalytics } from "./types";

type RawOption = {
  option: string;
  iv?: number;
  open_interest?: number;
  volume?: number;
  gamma?: number;
};

type CboeResponse = {
  timestamp: string;
  data: {
    current_price: number;
    iv30: number;
    options: RawOption[];
  };
};

type Parsed = RawOption & { type: "call" | "put"; strike: number; expiry: string };

function parseContract(contract: RawOption): Parsed | null {
  const match = contract.option.match(/^(?:[A-Z.]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const [, ymd, cp, rawStrike] = match;
  return {
    ...contract,
    type: cp === "C" ? "call" : "put",
    expiry: `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`,
    strike: Number(rawStrike) / 1000,
  };
}

function calculateMaxPain(chain: Parsed[], expiry: string): number | null {
  const contracts = chain.filter((o) => o.expiry === expiry && (o.open_interest ?? 0) > 0);
  const strikes = Array.from(new Set(contracts.map((o) => o.strike))).sort((a, b) => a - b);
  if (!strikes.length) return null;
  let best = strikes[0];
  let minimum = Infinity;
  for (const settlement of strikes) {
    let payout = 0;
    for (const o of contracts) {
      const intrinsic = o.type === "call"
        ? Math.max(0, settlement - o.strike)
        : Math.max(0, o.strike - settlement);
      payout += intrinsic * (o.open_interest ?? 0) * 100;
    }
    if (payout < minimum) { minimum = payout; best = settlement; }
  }
  return best;
}

function analyzeExpiry(chain: Parsed[], expiry: string, price: number): OptionExpiryAnalytics {
  const contracts = chain.filter((o) => o.expiry === expiry);
  const grouped = new Map<number, { call: number; put: number; gamma: number }>();
  for (const o of contracts) {
    const row = grouped.get(o.strike) ?? { call: 0, put: 0, gamma: 0 };
    const oi = Number(o.open_interest ?? 0);
    if (o.type === "call") row.call += oi; else row.put += oi;
    row.gamma += (o.type === "call" ? 1 : -1) * Number(o.gamma ?? 0) * oi * 100 * price * price * 0.01;
    grouped.set(o.strike, row);
  }
  const all = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
  const callWall = all.length ? all.reduce((best, row) => row[1].call > best[1].call ? row : best)[0] : null;
  const putWall = all.length ? all.reduce((best, row) => row[1].put > best[1].put ? row : best)[0] : null;
  let gammaFlipEstimate: number | null = null;
  let nearestCross = Infinity;
  for (let i = 1; i < all.length; i++) {
    const [leftStrike, left] = all[i - 1];
    const [rightStrike, right] = all[i];
    if (left.gamma === 0 || right.gamma === 0 || Math.sign(left.gamma) !== Math.sign(right.gamma)) {
      const midpoint = (leftStrike + rightStrike) / 2;
      const distance = Math.abs(midpoint - price);
      if (distance < nearestCross) { nearestCross = distance; gammaFlipEstimate = midpoint; }
    }
  }
  const strikes = all
    .sort((a, b) => Math.abs(a[0] - price) - Math.abs(b[0] - price))
    .slice(0, 18)
    .sort((a, b) => a[0] - b[0])
    .map(([strike, row]) => ({ strike, callOpenInterest: row.call, putOpenInterest: row.put, netGamma: row.gamma }));
  const callOpenInterest = contracts.filter((o) => o.type === "call").reduce((n, o) => n + Number(o.open_interest ?? 0), 0);
  const putOpenInterest = contracts.filter((o) => o.type === "put").reduce((n, o) => n + Number(o.open_interest ?? 0), 0);
  return {
    expiry,
    daysToExpiry: Math.max(0, Math.ceil((new Date(`${expiry}T20:00:00Z`).getTime() - Date.now()) / 86_400_000)),
    callOpenInterest, putOpenInterest, putCallRatio: putOpenInterest / Math.max(1, callOpenInterest),
    maxPain: calculateMaxPain(chain, expiry), callWall, putWall, gammaFlipEstimate, strikes,
  };
}

export async function getOptionsSnapshot(symbol: string): Promise<OptionsSnapshot> {
  const clean = symbol.toUpperCase().replace(/[^A-Z.]/g, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let raw: CboeResponse;
  try {
    const response = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(clean)}.json`, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "StockPulse/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Cboe HTTP ${response.status}`);
    raw = await response.json() as CboeResponse;
  } finally {
    clearTimeout(timer);
  }

  const price = Number(raw.data.current_price);
  const chain = raw.data.options.map(parseContract).filter((o): o is Parsed => Boolean(o));
  if (!chain.length) throw new Error(`No option chain for ${clean}`);
  const futureExpiries = Array.from(new Set(chain.map((o) => o.expiry))).sort();
  const nearestExpiry = futureExpiries[0] ?? null;
  const calls = chain.filter((o) => o.type === "call");
  const puts = chain.filter((o) => o.type === "put");
  const sum = (items: Parsed[], field: "open_interest" | "volume") => items.reduce((n, o) => n + Number(o[field] ?? 0), 0);
  const callOi = sum(calls, "open_interest");
  const putOi = sum(puts, "open_interest");
  const callVolume = sum(calls, "volume");
  const putVolume = sum(puts, "volume");
  const gammaExposure = chain.reduce((total, o) => {
    const sign = o.type === "call" ? 1 : -1;
    return total + sign * Number(o.gamma ?? 0) * Number(o.open_interest ?? 0) * 100 * price * price * 0.01;
  }, 0);

  const unusualContracts: UnusualOption[] = chain
    .filter((o) => Number(o.volume ?? 0) >= 100 && Number(o.volume ?? 0) > Number(o.open_interest ?? 0))
    .map((o) => ({
      contract: o.option,
      type: o.type,
      strike: o.strike,
      expiry: o.expiry,
      volume: Number(o.volume ?? 0),
      openInterest: Number(o.open_interest ?? 0),
      volumeOiRatio: Number(o.volume ?? 0) / Math.max(1, Number(o.open_interest ?? 0)),
      impliedVolatilityPct: Number(o.iv ?? 0) * 100,
    }))
    .sort((a, b) => b.volumeOiRatio - a.volumeOiRatio)
    .slice(0, 5);

  const iv30Pct = Number(raw.data.iv30 ?? 0);
  const expiries = futureExpiries.slice(0, 8).map((expiry) => analyzeExpiry(chain, expiry, price));
  return {
    symbol: clean,
    underlyingPrice: price,
    iv30Pct,
    expectedMove30d: price * (iv30Pct / 100) * Math.sqrt(30 / 365),
    callOpenInterest: callOi,
    putOpenInterest: putOi,
    putCallOiRatio: putOi / Math.max(1, callOi),
    callVolume,
    putVolume,
    putCallVolumeRatio: putVolume / Math.max(1, callVolume),
    gammaExposure,
    maxPain: nearestExpiry ? calculateMaxPain(chain, nearestExpiry) : null,
    nearestExpiry,
    unusualContracts,
    expiries,
    updatedAt: new Date(`${raw.timestamp.replace(" ", "T")}Z`).toISOString(),
    source: "cboe-delayed",
  };
}
