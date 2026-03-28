"use client";

import { useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { ChartDataPoint } from "@/lib/types";

const PERIODS: Array<{ label: string; days: number }> = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
];

const MA_COLORS = {
  ma20: "#f59e0b",
  ma50: "#3b82f6",
  ma200: "#8b5cf6",
};

interface Props {
  data: ChartDataPoint[];
  onPeriodChange?: (days: number) => void;
  loading?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3 shadow-xl text-xs">
      <p className="mb-2 font-semibold text-slate-200">
        {label ? format(parseISO(label), "MMM d, yyyy") : ""}
      </p>
      {payload.map((entry: { name: string; value: number; color: string }) => (
        <p key={entry.name} style={{ color: entry.color }} className="flex justify-between gap-6">
          <span className="capitalize">{entry.name}</span>
          <span className="font-mono font-semibold">
            {entry.name === "volume"
              ? (entry.value / 1_000_000).toFixed(2) + "M"
              : "$" + entry.value?.toFixed(2)}
          </span>
        </p>
      ))}
    </div>
  );
}

function formatXAxis(dateStr: string, dataLen: number) {
  try {
    const d = parseISO(dateStr);
    return dataLen > 200 ? format(d, "MMM yy") : format(d, "MMM d");
  } catch {
    return dateStr;
  }
}

export function StockChart({ data, onPeriodChange, loading }: Props) {
  const [activePeriod, setActivePeriod] = useState(365);

  const handlePeriod = (days: number) => {
    setActivePeriod(days);
    onPeriodChange?.(days);
  };

  const sliceDays = activePeriod;
  const sliced = data.slice(-sliceDays);

  const prices = sliced.map((d) => d.close);
  const minPrice = Math.min(...prices) * 0.97;
  const maxPrice = Math.max(...prices) * 1.03;

  if (loading) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-xl border border-surface-border bg-surface">
        <div className="animate-pulse text-sm text-neutral">Loading chart…</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-surface-border bg-surface p-4">
      {/* Period selector */}
      <div className="mb-4 flex items-center gap-1">
        {PERIODS.map(({ label, days }) => (
          <button
            key={label}
            onClick={() => handlePeriod(days)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              activePeriod === days
                ? "bg-accent text-white"
                : "text-neutral hover:bg-surface-elevated hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-4 flex items-center gap-3 text-xs">
          {Object.entries(MA_COLORS).map(([key, color]) => (
            <span key={key} className="flex items-center gap-1">
              <span className="inline-block h-2 w-5 rounded" style={{ backgroundColor: color }} />
              <span className="text-neutral">{key.toUpperCase()}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Main price chart */}
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={sliced} margin={{ top: 5, right: 5, bottom: 0, left: 10 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#252538" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => formatXAxis(v, sliced.length)}
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[minPrice, maxPrice]}
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => "$" + v.toFixed(0)}
            width={56}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="close"
            name="price"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#priceGrad)"
            dot={false}
            activeDot={{ r: 4, fill: "#3b82f6" }}
          />
          <Line
            type="monotone"
            dataKey="ma20"
            stroke={MA_COLORS.ma20}
            strokeWidth={1.5}
            dot={false}
            strokeDasharray="4 2"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="ma50"
            stroke={MA_COLORS.ma50}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="ma200"
            stroke={MA_COLORS.ma200}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Volume chart */}
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={sliced} margin={{ top: 0, right: 5, bottom: 0, left: 10 }}>
          <XAxis dataKey="date" hide />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (v / 1_000_000).toFixed(0) + "M"}
            width={56}
          />
          <Tooltip
            formatter={(v: number) => [(v / 1_000_000).toFixed(2) + "M", "Volume"]}
            contentStyle={{ background: "#111118", border: "1px solid #252538", fontSize: 12 }}
          />
          <Bar dataKey="volume" fill="#3b82f630" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
