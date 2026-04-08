# StockPulse

**AI-assisted stock analysis dashboard with advanced charting, macro regime context, and multi-source market data.**

---

## Overview

StockPulse is a full-stack stock analysis tool built with Next.js 14. It combines real-time market data from multiple providers, a full suite of technical indicators rendered on interactive charts, a macro market regime engine that synthesizes treasury yields, volatility, breadth, and policy signals, and AI-powered setup interpretation via Google Gemini.

The app is designed as a single-user analysis workstation — not a trading platform. It emphasizes transparent data sourcing, graceful degradation when APIs are unavailable, and honest confidence framing for all AI-generated outputs.

---

## Key Features

### Market Dashboard
- Live market indices (S&P 500, Nasdaq, Dow Jones) with auto-refresh
- Fear & Greed Index derived from VIX and S&P 500 momentum
- Configurable watchlist with sortable columns — price, change, RSI, MA alignment, setup score
- Manual refresh control with stale-data indicators

### Bull vs. Bear Macro Panel
- Market regime classification: Risk-On, Cautious, Risk-Off, Mixed
- Structured macro snapshot: 10Y/2Y/3M treasury yields, yield curve shape, VIX, DXY, WTI crude
- Policy path context derived from rates structure (2Y vs 3M T-bill spread)
- Market breadth via SPY/RSP ETF divergence + watchlist advance/decline
- Per-input signal transparency strip (live, derived, proxy, stale, missing)
- Deterministic confidence scoring with weighted input coverage
- AI-synthesized bull/bear narratives with watch items (Gemini) or rule-based fallback

### Stock Detail & Charting
- Line and candlestick chart modes
- 7 time ranges (1D, 5D, 1M, 3M, 6M, 1Y, ALL) with 4 interval options (1H, 1D, 1W, 1M)
- Moving averages: MA20, MA50, MA200 with color-coded overlays

### Advanced Technical Indicators
- **Bollinger Bands** (20-period, 2 standard deviations)
- **Stochastic Oscillator** (%K 14, %D 3) with overbought/oversold zones
- **MACD** (12/26/9) with histogram
- **ADX** (14-period) with +DI/-DI directional indicators
- **Ichimoku Cloud** (Tenkan, Kijun, Senkou A/B, Chikou Span)
- **Fibonacci Retracement** (7 levels with auto-detected swing points)
- **Fibonacci Extension** (6 levels)
- **Rolling Standard Deviation** (20-period volatility measure)
- **Andrews' Pitchfork** with 3 manual anchors — full 5-line structure (median, upper/lower tines, upper/lower warning lines at 2x offset)

### AI Setup Interpretation
- Context-aware analysis of the user's currently active chart indicators
- Structured indicator snapshots with machine-readable fields (crossover direction, zone, trend strength, Pitchfork position geometry)
- Structured macro context payload (regime, policy bias, volatility regime, breadth, drivers)
- Triggered manually via button — analyzes only what's visible on the chart
- Output: bias, regime description, bullish/bearish evidence with cited values, signal conflicts, confirmation/invalidation scenarios
- Content-hash-based caching with bucketed fingerprints to prevent stale hits
- Gemini-powered with rule-based fallback

### Technical Panel
- RSI with visual bar and zone labels
- Trend regime classification (Strong Uptrend through Strong Downtrend)
- Relative volume vs. 20-bar average
- MA alignment assessment
- Setup score (0–100) with methodology transparency
- 52-week range with distance indicators

### AI Stock Analysis
- Gemini-generated bull case, bear case, risks, recommendation, confidence level
- Optional entry/stop-loss levels
- Automatic fallback to rule-based analysis when API key is not configured

### News Panel
- Stock-specific news from Finnhub
- Category tags: Earnings, Product Launch, Legal, Partnership, Analyst Rating, Executive Change, Market Sentiment
- Sentiment classification (positive, neutral, negative)

### Data Architecture
- Snapshot-first design: SQLite store (better-sqlite3) serves stale data instantly while fresh data loads
- Three-tier caching: in-memory (configurable TTL per data type) → SQLite persistent store → live API fetch
- Circuit breakers on all external providers with exponential backoff
- Graceful degradation: app remains functional with missing optional API keys

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (strict mode) |
| UI | React 18, Tailwind CSS, Recharts |
| AI | Google Gemini 2.5 Flash (`@google/genai`) |
| Storage | SQLite via `better-sqlite3` (WAL mode) |
| Data Providers | Finnhub (primary), Yahoo Finance (fallback), CNN Fear & Greed |
| Icons | Lucide React |
| Date Handling | date-fns |
| Deployment | Docker, Docker Compose, Vercel-compatible |

---

## Screenshots

> Add screenshots to a `docs/` directory and update the paths below.

| View | Description |
|---|---|
| ![Dashboard](docs/dashboard.png) | Market indices, Fear & Greed, macro panel, watchlist |
| ![Stock Detail](docs/stock-detail.png) | Price chart with MA overlays, technical panel, AI analysis |
| ![Advanced Indicators](docs/indicators.png) | Bollinger Bands, MACD, Stochastic, Ichimoku Cloud |
| ![Pitchfork](docs/pitchfork.png) | Andrews' Pitchfork with manual anchors and warning lines |
| ![AI Setup Analysis](docs/setup-analysis.png) | Context-aware AI interpretation of active chart indicators |
| ![Macro Panel](docs/macro-panel.png) | Bull vs. Bear macro view with signal transparency |

---

## Architecture

```
Browser (React)
  │
  ├── Dashboard ──────── GET /api/indices
  │                      GET /api/fear-greed
  │                      GET /api/watchlist
  │                      GET /api/macro-view
  │
  ├── Stock Detail ───── GET /api/stock/[symbol]
  │                      GET /api/stock/[symbol]/history
  │                      GET /api/stock/[symbol]/news
  │                      GET /api/stock/[symbol]/analysis
  │
  └── Setup Analysis ─── POST /api/stock/[symbol]/setup-analysis
                              │
                              ▼
                    ┌─────────────────────┐
                    │  API Route Handler   │
                    └────────┬────────────┘
                             │
               ┌─────────���───┼─────────────┐
               ▼             ▼             ▼
          In-Memory      SQLite        Live API
           Cache         Store         Fetch
          (1–30 min)   (persistent)   (Finnhub/Yahoo)
                                         │
                                         ▼
                                    Gemini AI
                                   (optional)
```

**Data flow:** Every API route checks in-memory cache first, then SQLite store (serving stale data with a flag if fresh data has expired), then fetches live from external providers. This means the UI always gets a response quickly, even when external APIs are slow or rate-limited.

**Indicator computation:** All technical indicators (RSI, MACD, Bollinger, etc.) are computed server-side in `src/lib/calculations.ts` from raw OHLCV bars. No external indicator APIs are required.

**Macro snapshot:** Built from 6+ instrument fetches (treasuries, VIX, DXY, oil, SPY/RSP) with derived signals (yield curve shape, policy path, breadth). The snapshot feeds both the dashboard panel and the AI setup analysis.

---

## Setup

### Prerequisites
- Node.js 18+ and npm
- A Finnhub API key (free at [finnhub.io](https://finnhub.io/register))
- A Gemini API key for AI features (free at [aistudio.google.com](https://aistudio.google.com/app/apikey))

### 1. Clone and install

```bash
git clone https://github.com/hamperme/stock-analyzer.git
cd stock-analyzer
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your API keys:

```env
FINNHUB_API_KEY=your_finnhub_key
GEMINI_API_KEY=your_gemini_key
```

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Docker

```bash
cp .env.example .env
# Edit .env with your keys

docker compose up -d
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `FINNHUB_API_KEY` | Yes | Finnhub API key — primary data source for quotes, history, news |
| `GEMINI_API_KEY` | Yes* | Google Gemini API key — powers AI analysis and setup interpretation |
| `WATCHLIST_SYMBOLS` | No | Comma-separated ticker list (default: `AAPL,MSFT,GOOGL,NVDA,AMZN,META,TSLA,JPM,V,UNH`) |
| `TWELVEDATA_API_KEY` | No | Twelve Data key — supplementary indicator source when primary is rate-limited |
| `ALPHA_VANTAGE_KEY` | No | Alpha Vantage key — reserved for future enhanced news |
| `NEXT_PUBLIC_APP_URL` | No | Production URL for deployment |

\* The app runs without `GEMINI_API_KEY` — AI features fall back to rule-based analysis.

---

## Usage

1. **Dashboard** — View market indices, Fear & Greed, macro regime, and watchlist at a glance. Click the refresh button to pull fresh data.

2. **Stock detail** — Click any ticker to see the full chart, technical panel, AI analysis, and news. Switch between line and candlestick modes.

3. **Range and interval** — Use the range buttons (1D–ALL) and interval selector (1H–1M) to adjust the chart timeframe.

4. **Indicators** — Open the indicator panel to toggle Bollinger Bands, MACD, Stochastic, ADX, Ichimoku, Fibonacci, Pitchfork, and more. Each renders in real-time on the chart.

5. **Andrews' Pitchfork** — Enable Pitchfork, then click three points on the chart to set anchors. The tool draws the full 5-line structure (median, tines, warning lines).

6. **AI Setup Analysis** — With indicators active, click "Analyze Current Setup" in the indicator panel. The AI interprets only the indicators you have enabled, cites specific values, and notes conflicts. Macro context is included automatically when available.

7. **Macro panel** — The dashboard's Bull vs. Bear panel shows the current macro regime with signal-level transparency. Each data input is labeled as live, derived, proxy, stale, or missing.

---

## Limitations

This is an advanced analysis dashboard, not a production trading system. Current caveats:

- **Rate limits** — Finnhub free tier allows 60 calls/minute. Yahoo Finance may rate-limit aggressively. The app uses circuit breakers and exponential backoff, but heavy usage can still trigger cooldowns.
- **Proxy-based macro inputs** — Policy path is derived from treasury rate spreads (not FedWatch). Breadth uses SPY/RSP ETF divergence as a proxy, not NYSE advance/decline data.
- **ALL range depth** — The ALL range reflects stored history depth (up to ~2 years of daily bars from Finnhub), not full lifetime history.
- **Intraday limitations** — 1H interval is supported only when the data provider returns intraday bars. For most free-tier setups, daily is the finest reliable resolution.
- **AI dependency** — AI setup analysis and stock analysis require a configured Gemini API key. Without it, the app uses rule-based fallback (less insightful but fully functional).
- **Single-user design** — No authentication, multi-user sessions, or shared state. Intended as a local or single-deployment tool.
- **Debug endpoints** — The `/api/debug/*` routes expose system status information. These are useful for development but should be restricted or removed in any public-facing deployment.
- **No real-time streaming** — Data refreshes on request or on page load, not via WebSocket.

---

## Roadmap

Realistic improvements under consideration:

- [ ] FedWatch / FRED integration for stronger policy-path context
- [ ] NYSE advance/decline data for true market breadth
- [ ] Richer chart tooltips with indicator values on hover
- [ ] Saved indicator presets and layout persistence
- [ ] Watchlist editing UI (add/remove symbols from the browser)
- [ ] Manual anchor editing and drag-to-adjust for Pitchfork
- [ ] Multi-symbol overlay comparisons
- [ ] Alert thresholds for setup score or indicator conditions
- [ ] Authentication middleware for debug endpoints in production

---

## Data Sources & Disclaimer

- **Price data**: Finnhub (primary), Yahoo Finance (fallback) — may be delayed up to 15 minutes
- **Macro data**: Yahoo Finance for treasuries, VIX, DXY, oil, ETFs
- **AI analysis**: Google Gemini 2.5 Flash
- **Fear & Greed**: Derived from VIX level and S&P 500 momentum (not affiliated with CNN)

> **Disclaimer**: StockPulse is for informational and educational purposes only. It does not constitute financial advice. AI-generated outputs are interpretations, not recommendations. Always do your own research before making investment decisions.

---

## License

This project does not currently include a license file. All rights reserved until a license is added. If you intend to fork or redistribute, please add an appropriate open-source license first.
