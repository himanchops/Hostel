"use client";

import { BedStatus } from "@/lib/api";

/**
 * The five bed states, styled from the status tokens in globals.css. This
 * record is the only place those tokens are read — grid tiles, the legend and
 * any status chip all come through here, so the colours cannot drift apart.
 *
 * Classes are written out in full rather than interpolated so Tailwind's
 * scanner can see them.
 */
export const STATUS_STYLES: Record<
  BedStatus,
  { bg: string; border: string; text: string; dot: string; label: string }
> = {
  vacant: {
    bg: "bg-vacant-100", border: "border-vacant-200", text: "text-vacant-500",
    dot: "bg-vacant-500", label: "Vacant",
  },
  paid: {
    bg: "bg-paid-100", border: "border-paid-200", text: "text-paid-800",
    dot: "bg-paid-500", label: "Paid",
  },
  partial: {
    bg: "bg-partial-100", border: "border-partial-200", text: "text-partial-800",
    dot: "bg-partial-500", label: "Partial",
  },
  overdue: {
    bg: "bg-overdue-100", border: "border-overdue-200", text: "text-overdue-800",
    dot: "bg-overdue-500", label: "Overdue",
  },
  vacating_soon: {
    bg: "bg-vacating-100", border: "border-vacating-200", text: "text-vacating-800",
    dot: "bg-vacating-500", label: "Vacating",
  },
};

export function StatusPill({
  status,
  label,
  count,
  onClick,
  active,
  className = "",
}: {
  status: BedStatus;
  /** Overrides the canonical label — use sparingly. */
  label?: string;
  count?: number;
  /** Making the pill clickable turns it into a filter control. */
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const cfg = STATUS_STYLES[status];
  const base = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${cfg.bg} ${cfg.border} ${cfg.text}`;
  const inner = (
    <>
      <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
      {label ?? cfg.label}
      {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
    </>
  );

  if (!onClick) {
    return <div className={`${base} ${className}`.trim()}>{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} transition duration-150 ease-out hover:opacity-80 ${
        active ? "ring-2 ring-stone-400 ring-offset-1" : ""
      } ${className}`.trim()}
    >
      {inner}
    </button>
  );
}
