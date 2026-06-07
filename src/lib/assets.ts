import type { AssetType, StockQuote, WatchlistEntry } from "./types";

const CRYPTO_QUOTE_SUFFIXES = new Set([
  "USD",
  "USDT",
  "USDC",
  "BTC",
  "ETH",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
]);

export function getAssetType(symbol: string): AssetType {
  const normalized = symbol.trim().toUpperCase();
  const [base, quote, ...rest] = normalized.split("-");
  if (rest.length === 0 && base && quote && CRYPTO_QUOTE_SUFFIXES.has(quote)) {
    return "crypto";
  }
  return "stock";
}

export function isCryptoSymbol(symbol: string): boolean {
  return getAssetType(symbol) === "crypto";
}

export function getAssetTypeLabel(assetType: AssetType): string {
  return assetType === "crypto" ? "Crypto" : "Stock";
}

export function getAssetNoun(assetType: AssetType): string {
  return assetType === "crypto" ? "crypto asset" : "stock";
}

export function getCryptoBaseSymbol(symbol: string): string {
  const [base] = symbol.trim().toUpperCase().split("-");
  return base || symbol.trim().toUpperCase();
}

export function getDefaultAssetName(symbol: string): string {
  if (!isCryptoSymbol(symbol)) return symbol;
  const [base, quote] = symbol.trim().toUpperCase().split("-");
  return base && quote ? `${base}/${quote}` : symbol.trim().toUpperCase();
}

export function normalizeQuote(quote: StockQuote): StockQuote {
  return {
    ...quote,
    assetType: quote.assetType ?? getAssetType(quote.symbol),
  };
}

export function normalizeWatchlistEntry(entry: WatchlistEntry): WatchlistEntry {
  return {
    ...entry,
    assetType: entry.assetType ?? getAssetType(entry.symbol),
  };
}
