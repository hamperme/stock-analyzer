# StockPulse — Open-Source Stock Analyzer

A full-stack, real-time stock analysis web app with AI-powered insights, technical indicators, and market sentiment. Built with Next.js 14, Yahoo Finance data, and Google Gemini AI.

![Dashboard Preview](docs/preview.png)

## Features

| Feature | Description |
|---|---|
| **Market Dashboard** | Live S&P 500, Dow Jones, Nasdaq, Russell 2000 with auto-refresh |
| **Fear & Greed Index** | Proprietary score derived from VIX + S&P momentum |
| **Watchlist** | Configurable list with sortable columns — price, change, RSI, MA alignment, setup score |
| **Stock Detail** | Interactive price chart with MA20/MA50/MA200 overlays + volume |
| **Technical Panel** | RSI, trend regime, relative volume, distance from MAs, 52w range |
| **AI Analysis** | Gemini-powered bull/bear case, risks, recommendation, entry & stop levels |
| **News Panel** | Yahoo Finance news aggregated with importance tags and sentiment |
| **Caching** | Server-side in-memory cache to minimize API rate limiting |

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS, Recharts
- **Backend**: Next.js API Routes (Node.js)
- **Data**: `yahoo-finance2` (no key required)
- **AI**: Google Gemini 1.5 Flash (free tier)
- **Deployment**: Docker + Docker Compose

---

## Quick Start (Local Dev)

### Prerequisites
- Node.js 18+
- npm or yarn

### 1. Clone the repository
```bash
git clone https://github.com/your-username/stock-analyzer.git
cd stock-analyzer
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
# Required for AI Analysis (free tier available)
# Get your key at: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: customize your watchlist
# WATCHLIST_SYMBOLS=AAPL,MSFT,GOOGL,NVDA,AMZN
```

### 4. Run development server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Docker Deployment

### Using Docker Compose (recommended)

```bash
# 1. Create your .env file
cp .env.example .env
nano .env   # add your GEMINI_API_KEY

# 2. Build and start
docker compose up -d

# 3. Check logs
docker compose logs -f

# 4. Stop
docker compose down
```

### Using Docker directly

```bash
# Build
docker build -t stock-analyzer .

# Run
docker run -d \
  -p 3000:3000 \
  -e GEMINI_API_KEY=your_key_here \
  -e WATCHLIST_SYMBOLS=AAPL,MSFT,GOOGL,NVDA \
  --name stock-analyzer \
  stock-analyzer
```

---

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/stock-analyzer)

1. Click the button above
2. Add `GEMINI_API_KEY` in Vercel environment variables
3. Deploy!

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | For AI features | — | Google Gemini API key |
| `WATCHLIST_SYMBOLS` | No | `AAPL,MSFT,GOOGL,NVDA,AMZN,META,TSLA,JPM,V,UNH` | Comma-separated ticker list |
| `ALPHA_VANTAGE_KEY` | No | — | Alpha Vantage key (reserved for future use) |

---

## API Reference

All routes are under `/api/`:

| Endpoint | Description | Cache TTL |
|---|---|---|
| `GET /api/watchlist` | All watchlist entries with indicators | 1 min |
| `GET /api/stock/[symbol]` | Quote + technical indicators | 1 min |
| `GET /api/stock/[symbol]/history?days=365` | Historical OHLCV + MA lines | 5 min |
| `GET /api/stock/[symbol]/news` | Recent news with tags | 10 min |
| `GET /api/stock/[symbol]/analysis` | AI-powered analysis (Gemini) | 30 min |
| `GET /api/indices` | Major market indices | 1 min |
| `GET /api/fear-greed` | Fear & Greed score | 15 min |

---

## Customizing the Watchlist

Set the `WATCHLIST_SYMBOLS` environment variable to any valid Yahoo Finance tickers:

```env
WATCHLIST_SYMBOLS=AAPL,MSFT,GOOGL,NVDA,TSLA,AMZN,SPY,QQQ,GLD,BTC-USD
```

Supports stocks, ETFs, indices, and crypto.

---

## Setup Score Methodology

The Setup Score (0–100) is a composite technical signal:

| Component | Weight | Criteria |
|---|---|---|
| Trend alignment | 30 pts | MA50 > MA200 (golden cross), price vs MAs |
| RSI momentum | 25 pts | Ideal range: 45–65 |
| Relative volume | 25 pts | Higher = more institutional activity |
| Price structure | 20 pts | Distance from MA50 (0–5% = ideal) |

**Labels**: Strong Setup (80+) · Watch (60–79) · Neutral (40–59) · Avoid (<40)

---

## Data Sources & Disclaimer

- **Price data**: Yahoo Finance via `yahoo-finance2` (may be delayed 15 min)
- **AI analysis**: Google Gemini 1.5 Flash
- **Fear & Greed**: Calculated from VIX + S&P 500 momentum (not affiliated with CNN)

> **Disclaimer**: This tool is for informational and educational purposes only. It does not constitute financial advice. Always do your own research before making investment decisions.

---

## Contributing

Contributions welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

---

## License

MIT License — see [LICENSE](LICENSE) file.
