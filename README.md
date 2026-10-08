# StockPulse

Local market-analysis dashboard for US stocks and crypto. It combines current
OHLCV data, technical indicators, macro regime signals, US options analytics,
and crypto perpetual-futures positioning without embedded AI services.

## Features

- US stock and crypto watchlists
- Line and candlestick charts
- Provider-neutral model drawing tools: trendlines, rays, price/time levels,
  channels, zones, arrows, and labels ([API contract](docs/chart-drawing-tools.md))
- `1m`, `5m`, `15m`, `1H`, `4H`, `1D`, `1W`, and `1M` intervals
- MA20/50/200, RSI, Bollinger Bands, Stochastic, MACD, ADX, Ichimoku,
  Fibonacci, rolling standard deviation, and Andrews' Pitchfork
- Indicator warm-up history so short visible ranges retain valid calculations
- Feed source, freshness, last-bar time, and open/confirmed candle status
- US options: Put/Call OI and volume, IV30, expected move, GEX, Max Pain,
  Call/Put Wall, Gamma Flip estimate, strike OI distribution, unusual activity
- Crypto perpetuals: OI, funding, basis, long/short ratio, taker ratio
- Deterministic bull/bear macro regime engine
- SQLite snapshots and stale-data fallback
- Fast Yahoo circuit breaker with curl fallback
- Incremental, limited-concurrency refresh pipeline

## Data sources

- Finnhub: quotes, profiles, and news
- Yahoo Finance: historical and intraday OHLCV, macro instruments
- Binance USDⓈ-M: crypto perpetual futures and intraday candles
- Cboe delayed quotes: US option chains

Some feeds are delayed and remain subject to provider availability and rate
limits. Calculated derivatives metrics such as GEX and Gamma Flip are estimates.

## Setup

Requirements: Node.js 18+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Required | Description |
|---|---:|---|
| `FINNHUB_API_KEY` | Yes | Primary quote, profile, and news provider |
| `WATCHLIST_SYMBOLS` | No | Comma-separated stock and crypto symbols |
| `TWELVEDATA_API_KEY` | No | Additional historical-data fallback |
| `ALPHA_VANTAGE_KEY` | No | Reserved news fallback |
| `NEXT_PUBLIC_APP_URL` | No | Production application URL |

## Refresh behavior

- Intraday asset pages refresh once per minute while visible.
- Daily charts refresh every five minutes while visible.
- Returning to a backgrounded tab triggers an immediate refresh.
- Full Refresh downloads long history only for new symbols. Existing symbols
  receive a recent incremental update merged by timestamp.
- Data does not update while the local application is stopped unless an
  external scheduler calls `/api/refresh`.

## Docker

```bash
cp .env.example .env
docker compose up -d
```

## Disclaimer

Market data and calculated signals are for informational purposes only and do
not constitute financial advice.
