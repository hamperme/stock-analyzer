import { clsx } from "clsx";
import type { ReactNode } from "react";

type BadgeVariant =
  | "bull"
  | "bear"
  | "neutral"
  | "warn"
  | "accent"
  | "strong"
  | "watch"
  | "avoid";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  bull: "bg-bull/15 text-bull border-bull/30",
  bear: "bg-bear/15 text-bear border-bear/30",
  neutral: "bg-neutral/10 text-neutral border-neutral/20",
  warn: "bg-warn/15 text-warn border-warn/30",
  accent: "bg-accent/15 text-accent border-accent/30",
  strong: "bg-bull/20 text-bull border-bull/40 font-semibold",
  watch: "bg-warn/20 text-warn border-warn/40 font-semibold",
  avoid: "bg-bear/20 text-bear border-bear/40 font-semibold",
};

const sizeClasses = {
  sm: "px-1.5 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
};

export function Badge({ children, variant = "neutral", size = "sm", className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md border font-medium",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {children}
    </span>
  );
}

export function SetupBadge({ label }: { label: string }) {
  const variant =
    label === "Strong Setup"
      ? "strong"
      : label === "Watch"
      ? "watch"
      : label === "Avoid"
      ? "avoid"
      : "neutral";
  return <Badge variant={variant}>{label}</Badge>;
}

export function NewsSentimentBadge({ sentiment }: { sentiment: string }) {
  const variant =
    sentiment === "positive" ? "bull" : sentiment === "negative" ? "bear" : "neutral";
  const label =
    sentiment === "positive" ? "Positive" : sentiment === "negative" ? "Negative" : "Neutral";
  return <Badge variant={variant}>{label}</Badge>;
}

export function RecommendationBadge({ rec }: { rec: string }) {
  const variant =
    rec === "Strong Buy"
      ? "strong"
      : rec === "Buy"
      ? "bull"
      : rec === "Neutral"
      ? "neutral"
      : rec === "Sell"
      ? "bear"
      : "avoid";
  return (
    <Badge variant={variant} size="md">
      {rec}
    </Badge>
  );
}
