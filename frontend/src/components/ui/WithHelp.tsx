"use client";

import { useId, useState, type ReactNode } from "react";
import { InfoIcon } from "./icons";
import { TOUCH_TARGET } from "./touch";

/**
 * An explanation behind an ⓘ beside its heading, shut until asked for.
 *
 * Help text is right the first time and clutter every time after (owner, Oct
 * 2026): the paragraph under Delete tenant, the notes in Record notice. A tap,
 * not a hover, because the iPad has no hover.
 */
export function WithHelp({ heading, label, children, className = "" }: {
  heading: ReactNode;
  /** What the button says to a screen reader: "About deleting a tenant". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        {heading}
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className={`${TOUCH_TARGET} inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition duration-150 ease-out ${open ? "text-indigo-600" : "text-stone-400 hover:text-stone-600"}`}
        >
          <InfoIcon className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <div id={id} className="mt-1 max-w-prose text-sm text-stone-500">
          {children}
        </div>
      )}
    </div>
  );
}
