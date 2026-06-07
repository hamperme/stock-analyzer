import { NextResponse } from "next/server";
import { getAssetType, isCryptoSymbol } from "@/lib/assets";
import type { WatchlistSearchResult } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED_QUOTE_TYPES = new Set(["EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY"]);

interface YahooSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  exchange?: string;
  quoteType?: string;
}

interface YahooSearchResponse {
  quotes?: YahooSearchQuote[];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();

  if (query.length < 1) {
    return NextResponse.json({ data: [] });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0&enableFuzzyQuery=true`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Yahoo search HTTP ${res.status}`);
    }

    const json = await res.json() as YahooSearchResponse;
    const seen = new Set<string>();
    const data: WatchlistSearchResult[] = [];

    for (const quote of json.quotes ?? []) {
      const symbol = (quote.symbol ?? "").trim().toUpperCase();
      if (!symbol || seen.has(symbol) || symbol.startsWith("^")) continue;
      if (quote.quoteType && !ALLOWED_QUOTE_TYPES.has(quote.quoteType)) continue;

      const assetType = quote.quoteType === "CRYPTOCURRENCY" || isCryptoSymbol(symbol)
        ? "crypto"
        : getAssetType(symbol);

      seen.add(symbol);
      data.push({
        symbol,
        assetType,
        shortName: quote.shortname ?? quote.longname ?? symbol,
        longName: quote.longname ?? quote.shortname ?? symbol,
        exchange: quote.exchDisp ?? quote.exchange ?? null,
      });
    }

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { data: [], error: `Search failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
