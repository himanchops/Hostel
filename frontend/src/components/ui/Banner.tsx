"use client";

import Link from "next/link";
import { BadgeTone } from "./Badge";

/**
 * Tinted attention strip — the dashboard's "N registrations awaiting approval"
 * rows. Not in the original Phase B list, but the alternative was leaving raw
 * `bg-amber-50 ring-amber-200` classNames on the page, which is exactly what
 * the extraction is meant to remove. Uses Badge tones, not status tokens.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-stone-50 text-stone-700 ring-stone-200 hover:bg-stone-100",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100",
  warning: "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100",
  danger: "bg-red-50 text-red-800 ring-red-200 hover:bg-red-100",
  info: "bg-blue-50 text-blue-800 ring-blue-200 hover:bg-blue-100",
};

export function Banner({
  tone = "neutral",
  href,
  children,
  className = "",
}: {
  tone?: BadgeTone;
  /** When set the whole banner becomes a link. */
  href?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const classes = `flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ring-1 ring-inset transition duration-150 ease-out ${TONES[tone]} ${className}`.trim();

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return <div className={classes}>{children}</div>;
}
