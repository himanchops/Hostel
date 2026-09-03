"use client";

import { useState } from "react";

/**
 * A card whose body folds away, with a summary that stays visible when it is
 * shut.
 *
 * The summary is the point. A collapsed panel that says only "By room" makes
 * the reader open it to find out whether it is worth opening; one that says
 * "8 rooms · 1 never let" often answers the question outright. Panels that
 * cannot summarise themselves in a few words probably should not be
 * collapsible.
 *
 * Content is unmounted rather than hidden, so a folded chart is not measuring
 * a zero-width container in the background and caching a broken layout.
 */
export function Collapsible({
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** Shown next to the title — most useful when the panel is shut. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-xl bg-white ring-1 ring-stone-200">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition duration-150 ease-out hover:bg-stone-50"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
            className={`h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform duration-150 ease-out ${
              open ? "rotate-90" : ""
            }`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-base font-semibold text-stone-900">{title}</span>
          {summary && (
            <span className="ml-auto truncate text-[11px] tabular-nums text-stone-400">
              {summary}
            </span>
          )}
        </button>
      </h2>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}
