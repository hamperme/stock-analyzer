import { NextResponse } from "next/server";
import { resetCircuitBreakers, getCircuitBreakerStatus } from "@/lib/yahoo-finance";

export async function GET() {
  const status = getCircuitBreakerStatus();
  return NextResponse.json({ circuitBreakers: status });
}

export async function POST() {
  resetCircuitBreakers();
  return NextResponse.json({ message: "Circuit breakers reset", circuitBreakers: getCircuitBreakerStatus() });
}
