"use client";

import { TOUCH_TARGET } from "./touch";

/**
 * A stacked set of mutually exclusive answers, for choices too long to sit
 * side by side in a SegmentedControl at 375px: "The old rent, ₹4,500" and
 * its siblings. The selected answer takes the accent, like a selected chip.
 */
export function ChoiceList<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly { value: T; label: React.ReactNode }[];
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="space-y-1.5">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={`${TOUCH_TARGET} flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ring-1 ring-inset transition duration-150 ease-out ${
              selected
                ? "bg-indigo-50 font-medium text-indigo-800 ring-indigo-300"
                : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50"
            }`}
          >
            <span
              aria-hidden
              className={`h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-inset ${
                selected ? "bg-indigo-600 ring-indigo-600 shadow-[inset_0_0_0_3px_white]" : "ring-stone-400"
              }`}
            />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
