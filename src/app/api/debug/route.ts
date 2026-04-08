import { NextResponse } from "next/server";
import { resetCircuitBreakers, getCircuitBreakerStatus } from "@/lib/yahoo-finance";
import { getFinnhubStatus } from "@/lib/finnhub";
import { getStoreStatus } from "@/lib/store";

export async function GET() {
  const storeStatus = getStoreStatus();
  return NextResponse.json({
    circuitBreakers: {
      yahoo: getCircuitBreakerStatus(),
      finnhub: getFinnhubStatus(),
    },
    store: {
      dbPath: storeStatus.dbPath,
      exists: storeStatus.exists,
      symbolCount: storeStatus.symbols.length,
      counts: storeStatus.counts,
      lastFullRefresh: storeStatus.meta.lastFullRefresh,
      recentErrors: storeStatus.meta.errors.slice(-5),
    },
  });
}

export async function POST() {
  resetCircuitBreakers();
  return NextResponse.json({ message: "Circuit breakers reset", circuitBreakers: getCircuitBreakerStatus() });
}
