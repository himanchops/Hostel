"use client";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

/**
 * Non-status chips: payment types, notice markers, counts.
 *
 * These deliberately use raw Tailwind hues rather than the status tokens in
 * globals.css — those are reserved for bed status, so that a green thing on
 * screen always means "paid" and nothing else.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-stone-100 text-stone-600 ring-stone-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-blue-50 text-blue-700 ring-blue-200",
};

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-medium ring-1 ring-inset ${TONES[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}

/**
 * Small count bubble — sidebar badges, alert counts. `sm` is for badges that
 * sit on top of something else, like the bottom tab bar's icons, where the
 * default size crowds the icon it is annotating.
 */
export function CountBadge({
  tone = "warning",
  size = "md",
  children,
}: {
  tone?: BadgeTone;
  size?: "sm" | "md";
  children: React.ReactNode;
}) {
  const dims = size === "sm" ? "h-4 min-w-4 px-1 text-[10px]" : "h-5 min-w-5 px-1.5 text-xs";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold tabular-nums ring-1 ring-inset ${dims} ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
