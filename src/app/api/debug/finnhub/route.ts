import { NextResponse } from "next/server";
import { getQuote, getHistoricalData, getFinnhubStatus } from "@/lib/finnhub";

export async function GET() {
  const status = getFinnhubStatus();

  const result: Record<string, unknown> = {
    finnhubKeyPresent: status.hasKey,
    circuitBreaker: {
      blocked: status.blocked,
      unblocksInSec: status.unblocksIn,
    },
    quote: null as unknown,
    history: null as unknown,
  };

  if (!status.hasKey) {
    result.quote = { ok: false, error: "FINNHUB_API_KEY is not set" };
    result.history = { ok: false, error: "FINNHUB_API_KEY is not set" };
    return NextResponse.json(result);
  }

  // Test quote
  try {
    const q = await getQuote("AAPL");
    result.quote = { ok: true, price: q.price, symbol: q.symbol, shortName: q.shortName };
  } catch (err) {
    result.quote = { ok: false, error: (err as Error).message };
  }

  // Test history
  try {
    const bars = await getHistoricalData("AAPL", 30);
    result.history = { ok: true, bars: bars.length, firstDate: bars[0]?.date, lastDate: bars[bars.length - 1]?.date };
  } catch (err) {
    result.history = { ok: false, error: (err as Error).message };
  }

  return NextResponse.json(result);
}
