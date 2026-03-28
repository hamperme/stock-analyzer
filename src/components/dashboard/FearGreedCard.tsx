"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/LoadingSpinner";
import type { FearGreedData, FearGreedLabel } from "@/lib/types";

const labelConfig: Record<FearGreedLabel, { color: string; bg: string; needle: string }> = {
  "Extreme Fear": { color: "text-red-400", bg: "bg-red-500", needle: "rotate-[-85deg]" },
  "Fear":         { color: "text-orange-400", bg: "bg-orange-500", needle: "rotate-[-40deg]" },
  "Neutral":      { color: "text-slate-300", bg: "bg-slate-500", needle: "rotate-0" },
  "Greed":        { color: "text-emerald-400", bg: "bg-emerald-500", needle: "rotate-[40deg]" },
  "Extreme Greed":{ color: "text-green-400", bg: "bg-green-500", needle: "rotate-[85deg]" },
};

function GaugeMeter({ score }: { score: number }) {
  // score: 0-100 → angle: -90 to +90 degrees
  const angle = (score / 100) * 180 - 90;

  const zones = [
    { color: "#ef4444", start: 0, end: 36 },
    { color: "#f97316", start: 36, end: 72 },
    { color: "#94a3b8", start: 72, end: 108 },
    { color: "#34d399", start: 108, end: 144 },
    { color: "#10b981", start: 144, end: 180 },
  ];

  const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const describeArc = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
    const s = polarToCartesian(cx, cy, r, startAngle);
    const e = polarToCartesian(cx, cy, r, endAngle);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  const needleAngle = angle;
  const needleRad = ((needleAngle - 90) * Math.PI) / 180;
  const needleLen = 52;
  const cx = 80, cy = 80;
  const nx = cx + needleLen * Math.cos(needleRad);
  const ny = cy + needleLen * Math.sin(needleRad);

  return (
    <svg viewBox="0 0 160 90" className="w-full max-w-[200px]">
      {zones.map((z) => (
        <path
          key={z.color}
          d={describeArc(cx, cy, 60, z.start - 90, z.end - 90)}
          fill="none"
          stroke={z.color}
          strokeWidth="12"
          strokeLinecap="butt"
          opacity="0.85"
        />
      ))}
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="4" fill="white" />
    </svg>
  );
}

export function FearGreedCard() {
  const [data, setData] = useState<FearGreedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/fear-greed")
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json.data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonCard className="h-full" />;

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Fear &amp; Greed</CardTitle>
        </CardHeader>
        <p className="text-sm text-bear">{error ?? "No data"}</p>
      </Card>
    );
  }

  const cfg = labelConfig[data.label];

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Fear &amp; Greed Index</CardTitle>
        <span className="text-xs text-neutral">via CNN Business</span>
      </CardHeader>

      <div className="flex flex-1 flex-col items-center justify-center gap-1">
        <GaugeMeter score={data.score} />

        <div className="text-center">
          <p className={`text-4xl font-black ${cfg.color}`}>{data.score}</p>
          <p className={`mt-0.5 text-base font-semibold ${cfg.color}`}>{data.label}</p>
        </div>

        <div className="mt-3 grid w-full grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-surface-elevated p-2 text-center">
            <p className="text-neutral">Prev Close</p>
            <p className={`font-bold ${data.vixChange >= 0 ? "text-bull" : "text-bear"}`}>
              {data.vix.toFixed(1)}
              <span className="ml-1 font-normal text-neutral">
                ({data.vixChange > 0 ? "+" : ""}{data.vixChange.toFixed(1)})
              </span>
            </p>
          </div>
          <div className="rounded-lg bg-surface-elevated p-2 text-center">
            <p className="text-neutral">vs Last Week</p>
            <p className={`font-bold ${data.spMomentum >= 0 ? "text-bull" : "text-bear"}`}>
              {data.spMomentum > 0 ? "+" : ""}{data.spMomentum.toFixed(1)}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
