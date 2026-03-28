import { clsx } from "clsx";

interface Props {
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}

const sizeMap = { sm: "h-4 w-4", md: "h-6 w-6", lg: "h-10 w-10" };

export function LoadingSpinner({ size = "md", className, label }: Props) {
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <svg
        className={clsx("animate-spin text-accent", sizeMap[size])}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      {label && <span className="text-sm text-neutral">{label}</span>}
    </div>
  );
}

export function SkeletonRow({ cols = 8 }: { cols?: number }) {
  return (
    <tr className="border-b border-surface-border animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-surface-elevated" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={clsx("animate-pulse rounded-xl border border-surface-border bg-surface p-4", className)}>
      <div className="mb-3 h-4 w-1/3 rounded bg-surface-elevated" />
      <div className="mb-2 h-8 w-2/3 rounded bg-surface-elevated" />
      <div className="h-3 w-1/2 rounded bg-surface-elevated" />
    </div>
  );
}
