import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { BarChart2 } from "lucide-react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "StockPulse — Stock Analyzer",
  description: "Real-time stock analysis with AI-powered insights, technical indicators, and market sentiment.",
  keywords: ["stock analyzer", "technical analysis", "RSI", "moving averages", "fear and greed"],
};

function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-surface-border bg-app-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20">
            <BarChart2 className="h-4 w-4 text-accent" />
          </div>
          <span className="font-bold text-slate-100 text-lg">StockPulse</span>
        </Link>
        <div className="flex items-center gap-3 text-xs text-neutral">
          <span className="hidden sm:inline">
            Data via Finnhub &amp; Yahoo Finance · AI via Gemini
          </span>
          <a
            href="https://github.com/hamperme/stock-analyzer"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-neutral hover:bg-surface-elevated hover:text-slate-200 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <Navbar />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
        <footer className="mt-12 border-t border-surface-border py-6 text-center text-xs text-neutral/60">
          <p>
            StockPulse · Data for informational purposes only · Not financial advice ·{" "}
            <a href="https://github.com/hamperme/stock-analyzer" className="underline hover:text-neutral">
              Open Source
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}
