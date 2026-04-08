/**
 * Persistent SQLite storage for market data snapshots.
 *
 * Architecture:
 *  - All market data is persisted in a local SQLite database (data/stockpulse.db)
 *  - API routes read from store FIRST — no live provider calls on normal page loads
 *  - Stale data is always returned with a `stale` flag rather than empty
 *  - The refresh pipeline (/api/refresh) writes new snapshots; routes just read
 *
 * Tables:
 *   snapshots(kind, key, data JSON, updated_at TEXT)
 *     kind: 'quote' | 'history' | 'watchlist' | 'news' | 'analysis' | 'indices'
 *     key:  symbol or '_global' for singletons (watchlist, indices)
 *
 *   meta(key TEXT PRIMARY KEY, value TEXT)
 *     Stores refresh timestamps and error log
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { StockQuote, HistoricalBar, WatchlistEntry, NewsItem, AIAnalysis, MarketIndex, MacroView, MacroSnapshot } from "./types";

// ─── Staleness thresholds (ms) — data older than this is "stale" but still served
export const STALE = {
  QUOTE: 5 * 60_000,          // 5 minutes
  HISTORY: 12 * 60 * 60_000,  // 12 hours
  WATCHLIST: 10 * 60_000,     // 10 minutes
  NEWS: 30 * 60_000,          // 30 minutes
  ANALYSIS: 2 * 60 * 60_000,  // 2 hours
  INDICES: 5 * 60_000,        // 5 minutes
  MACRO_SNAPSHOT: 30 * 60_000,  // 30 minutes — raw macro data
  MACRO_VIEW: 4 * 60 * 60_000, // 4 hours — synthesized view
};

// ─── Database singleton ──────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "stockpulse.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("busy_timeout = 5000");

  // Create tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      kind       TEXT NOT NULL,
      key        TEXT NOT NULL,
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, key)
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return _db;
}

// ─── Generic helpers ─────────────────────────────────────────────────────────

function upsert(kind: string, key: string, data: unknown): void {
  const db = getDb();
  const json = JSON.stringify(data);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO snapshots (kind, key, data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(kind, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(kind, key, json, now);
}

interface LoadResult<T> {
  data: T;
  updatedAt: string;
  ageMs: number;
  stale: boolean;
}

function load<T>(kind: string, key: string, staleThreshold: number): LoadResult<T> | null {
  const db = getDb();
  const row = db.prepare(`SELECT data, updated_at FROM snapshots WHERE kind = ? AND key = ?`).get(kind, key) as
    | { data: string; updated_at: string }
    | undefined;
  if (!row) return null;
  const data: T = JSON.parse(row.data);
  const ageMs = Date.now() - new Date(row.updated_at).getTime();
  return { data, updatedAt: row.updated_at, ageMs, stale: ageMs > staleThreshold };
}

// ─── Quote ───────────────────────────────────────────────────────────────────

export function saveQuote(symbol: string, quote: StockQuote): void {
  upsert("quote", symbol, quote);
}

export function loadQuote(symbol: string): LoadResult<StockQuote> | null {
  return load<StockQuote>("quote", symbol, STALE.QUOTE);
}

// ─── History ─────────────────────────────────────────────────────────────────

export function saveHistory(symbol: string, bars: HistoricalBar[]): void {
  upsert("history", symbol, bars);
}

export function loadHistory(symbol: string): LoadResult<HistoricalBar[]> | null {
  return load<HistoricalBar[]>("history", symbol, STALE.HISTORY);
}

// ─── Watchlist ───────────────────────────────────────────────────────────────

export function saveWatchlist(entries: WatchlistEntry[]): void {
  upsert("watchlist", "_global", entries);
}

export function loadWatchlist(): LoadResult<WatchlistEntry[]> | null {
  return load<WatchlistEntry[]>("watchlist", "_global", STALE.WATCHLIST);
}

// ─── News ────────────────────────────────────────────────────────────────────

export function saveNews(symbol: string, news: NewsItem[]): void {
  upsert("news", symbol, news);
}

export function loadNews(symbol: string): LoadResult<NewsItem[]> | null {
  return load<NewsItem[]>("news", symbol, STALE.NEWS);
}

// ─── Analysis ────────────────────────────────────────────────────────────────

export function saveAnalysis(symbol: string, analysis: AIAnalysis): void {
  upsert("analysis", symbol, analysis);
}

export function loadAnalysis(symbol: string): LoadResult<AIAnalysis> | null {
  return load<AIAnalysis>("analysis", symbol, STALE.ANALYSIS);
}

// ─── Indices ─────────────────────────────────────────────────────────────────

export function saveIndices(indices: MarketIndex[]): void {
  upsert("indices", "_global", indices);
}

export function loadIndices(): LoadResult<MarketIndex[]> | null {
  return load<MarketIndex[]>("indices", "_global", STALE.INDICES);
}

// ─── Macro Snapshot ─────────────────────────────────────────────────────────

export function saveMacroSnapshot(snapshot: MacroSnapshot): void {
  upsert("macro_snapshot", "_global", snapshot);
}

export function loadMacroSnapshot(): LoadResult<MacroSnapshot> | null {
  return load<MacroSnapshot>("macro_snapshot", "_global", STALE.MACRO_SNAPSHOT);
}

// ─── Macro View ─────────────────────────────────────────────────────────────

export function saveMacroView(view: MacroView): void {
  upsert("macro_view", "_global", view);
}

export function loadMacroView(): LoadResult<MacroView> | null {
  return load<MacroView>("macro_view", "_global", STALE.MACRO_VIEW);
}

// ─── Meta / refresh log ──────────────────────────────────────────────────────

export interface RefreshMeta {
  lastFullRefresh: string | null;
  lastQuoteRefresh: string | null;
  lastHistoryRefresh: string | null;
  lastWatchlistRefresh: string | null;
  errors: Array<{ time: string; message: string }>;
}

const EMPTY_META: RefreshMeta = {
  lastFullRefresh: null,
  lastQuoteRefresh: null,
  lastHistoryRefresh: null,
  lastWatchlistRefresh: null,
  errors: [],
};

export function loadMeta(): RefreshMeta {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'refresh_meta'`).get() as
    | { value: string }
    | undefined;
  if (!row) return { ...EMPTY_META };
  try {
    return JSON.parse(row.value);
  } catch {
    return { ...EMPTY_META };
  }
}

export function saveMeta(meta: RefreshMeta): void {
  // Keep only last 50 errors
  meta.errors = meta.errors.slice(-50);
  const db = getDb();
  db.prepare(`
    INSERT INTO meta (key, value) VALUES ('refresh_meta', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(meta));
}

// ─── Store status / debug ────────────────────────────────────────────────────

export function getStoreStatus(): {
  dbPath: string;
  exists: boolean;
  symbols: string[];
  meta: RefreshMeta;
  counts: Record<string, number>;
} {
  const exists = fs.existsSync(DB_PATH);
  if (!exists) {
    return { dbPath: DB_PATH, exists, symbols: [], meta: { ...EMPTY_META }, counts: {} };
  }

  const db = getDb();

  // Get all symbols that have history
  const histRows = db.prepare(`SELECT key FROM snapshots WHERE kind = 'history'`).all() as { key: string }[];
  const symbols = histRows.map((r) => r.key);

  // Count rows per kind
  const countRows = db.prepare(`SELECT kind, COUNT(*) as cnt FROM snapshots GROUP BY kind`).all() as { kind: string; cnt: number }[];
  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.kind] = r.cnt;

  return { dbPath: DB_PATH, exists, symbols, meta: loadMeta(), counts };
}
