import { randomUUID } from "crypto";
import type {
  ChartDrawing,
  ChartDrawingKind,
  ChartDrawingPoint,
  ChartDrawingStyle,
} from "./types";

export const MAX_CHART_DRAWINGS = 100;

const POINT_COUNTS: Record<ChartDrawingKind, number> = {
  trendline: 2,
  ray: 2,
  horizontal: 1,
  vertical: 1,
  channel: 3,
  rectangle: 2,
  arrow: 2,
  polyline: 2,
  label: 1,
};

const KINDS = Object.keys(POINT_COUNTS) as ChartDrawingKind[];
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+)$/i;

function finiteNumber(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${field} must be a finite number`);
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePoint(value: unknown, index: number): ChartDrawingPoint {
  if (!value || typeof value !== "object") throw new Error(`points[${index}] must be an object`);
  const point = value as Record<string, unknown>;
  const date = String(point.date ?? "").trim();
  if (!date || Number.isNaN(Date.parse(date))) throw new Error(`points[${index}].date must be an ISO date/time`);
  return { date, price: finiteNumber(point.price, `points[${index}].price`) };
}

function normalizeColor(value: unknown, fallback?: string): string | undefined {
  if (value === undefined || value === null || value === "") return fallback;
  const color = String(value).trim();
  if (!COLOR_RE.test(color) || color.length > 48) throw new Error(`Invalid drawing color: ${color}`);
  return color;
}

function normalizeStyle(value: unknown): ChartDrawingStyle {
  if (value === undefined) return {};
  if (!value || typeof value !== "object") throw new Error("style must be an object");
  const style = value as Record<string, unknown>;
  const dash = style.dash === undefined ? undefined : String(style.dash).replace(/[^0-9 .,]/g, "").slice(0, 30);
  return {
    color: normalizeColor(style.color, "#38bdf8"),
    width: style.width === undefined ? 1.5 : clamp(finiteNumber(style.width, "style.width"), 0.5, 8),
    opacity: style.opacity === undefined ? 0.9 : clamp(finiteNumber(style.opacity, "style.opacity"), 0, 1),
    dash: dash || undefined,
    fill: normalizeColor(style.fill),
    fillOpacity: style.fillOpacity === undefined ? 0.08 : clamp(finiteNumber(style.fillOpacity, "style.fillOpacity"), 0, 1),
  };
}

export function normalizeChartDrawing(value: unknown): ChartDrawing {
  if (!value || typeof value !== "object") throw new Error("drawing must be an object");
  const drawing = value as Record<string, unknown>;
  const kind = String(drawing.kind ?? "") as ChartDrawingKind;
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of: ${KINDS.join(", ")}`);

  if (!Array.isArray(drawing.points)) throw new Error("points must be an array");
  const expected = POINT_COUNTS[kind];
  if (kind === "polyline") {
    if (drawing.points.length < 2 || drawing.points.length > 50) throw new Error("polyline requires 2 to 50 points");
  } else if (drawing.points.length !== expected) {
    throw new Error(`${kind} requires exactly ${expected} point(s)`);
  }

  const label = drawing.label === undefined ? undefined : String(drawing.label).trim().slice(0, 160);
  const rawId = String(drawing.id ?? randomUUID()).trim();
  const id = rawId.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 100) || randomUUID();
  const createdBy = drawing.createdBy === "user" ? "user" : "model";
  const metadata = drawing.metadata && typeof drawing.metadata === "object" && !Array.isArray(drawing.metadata)
    ? drawing.metadata as ChartDrawing["metadata"]
    : undefined;

  return {
    id,
    kind,
    points: drawing.points.map(normalizePoint),
    label,
    style: normalizeStyle(drawing.style),
    extendLeft: Boolean(drawing.extendLeft),
    extendRight: Boolean(drawing.extendRight),
    visible: drawing.visible !== false,
    createdBy,
    metadata,
  };
}

export function normalizeChartDrawings(value: unknown): ChartDrawing[] {
  if (!Array.isArray(value)) throw new Error("drawings must be an array");
  if (value.length > MAX_CHART_DRAWINGS) throw new Error(`Maximum ${MAX_CHART_DRAWINGS} drawings per symbol/interval`);
  const normalized = value.map(normalizeChartDrawing);
  const deduped = new Map(normalized.map((drawing) => [drawing.id, drawing]));
  return Array.from(deduped.values());
}

export const CHART_DRAWING_TOOL_CONTRACT = {
  name: "chart_drawings",
  description: "Create, update, list, replace, or delete analytical overlays on a stock candle chart.",
  endpoint: "/api/stock/{SYMBOL}/drawings?interval={INTERVAL}",
  operations: {
    list: "GET",
    upsert: "POST body: { drawing } or { drawings }",
    replaceAll: "PUT body: { drawings }",
    deleteOne: "DELETE ?interval={INTERVAL}&id={DRAWING_ID}",
    clear: "DELETE ?interval={INTERVAL}&all=1",
  },
  kinds: { ...POINT_COUNTS, polyline: "2..50" },
  point: { date: "ISO date/time", price: "number" },
  style: {
    color: "CSS color",
    width: "0.5..8",
    opacity: "0..1",
    dash: "SVG dash pattern, e.g. '6 3'",
    fill: "CSS color",
    fillOpacity: "0..1",
  },
  example: {
    drawing: {
      id: "model-support-1",
      kind: "trendline",
      points: [
        { date: "2026-01-02T14:30:00.000Z", price: 180.25 },
        { date: "2026-02-03T14:30:00.000Z", price: 194.5 },
      ],
      label: "Rising support",
      extendRight: true,
      style: { color: "#22c55e", width: 2, dash: "6 3", opacity: 0.9 },
      createdBy: "model",
    },
  },
} as const;
