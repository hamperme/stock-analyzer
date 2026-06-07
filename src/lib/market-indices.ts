import type { DashboardMarket } from "./app-settings";

export interface MarketIndexDefinition {
  symbol: string;
  name: string;
}

const MARKET_INDEX_SETS: Record<DashboardMarket, MarketIndexDefinition[]> = {
  us: [
    { symbol: "^GSPC", name: "S&P 500" },
    { symbol: "^DJI", name: "Dow Jones" },
    { symbol: "^IXIC", name: "Nasdaq" },
    { symbol: "^RUT", name: "Russell 2000" },
  ],
  japan: [
    { symbol: "^N225", name: "Nikkei 225" },
    { symbol: "^TOPX", name: "TOPIX" },
    { symbol: "EWJ", name: "iShares MSCI Japan ETF" },
    { symbol: "DXJ", name: "WisdomTree Japan Hedged Equity" },
  ],
  europe: [
    { symbol: "^STOXX50E", name: "Euro Stoxx 50" },
    { symbol: "^FTSE", name: "FTSE 100" },
    { symbol: "^GDAXI", name: "DAX" },
    { symbol: "^FCHI", name: "CAC 40" },
  ],
  china: [
    { symbol: "000001.SS", name: "Shanghai Composite" },
    { symbol: "^HSI", name: "Hang Seng" },
    { symbol: "FXI", name: "iShares China Large-Cap ETF" },
    { symbol: "KWEB", name: "KraneShares China Internet ETF" },
  ],
  canada: [
    { symbol: "^GSPTSE", name: "S&P/TSX Composite" },
    { symbol: "XIU.TO", name: "iShares S&P/TSX 60 ETF" },
    { symbol: "XIC.TO", name: "iShares Core S&P/TSX Capped Composite ETF" },
    { symbol: "ZCN.TO", name: "BMO S&P/TSX Capped Composite ETF" },
  ],
};

export function getMarketIndexDefinitions(market: DashboardMarket): MarketIndexDefinition[] {
  return MARKET_INDEX_SETS[market] ?? MARKET_INDEX_SETS.us;
}
