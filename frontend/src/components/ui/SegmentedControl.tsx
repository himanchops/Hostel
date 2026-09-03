"use client";

/**
 * A small run of mutually exclusive options — the Insights range picker.
 *
 * Extracted rather than written inline on the page: the selected segment is a
 * white surface on a stone track, which is the same `ring-stone-200` recipe
 * Card owns, and pages are not allowed to hand-roll that (see CLAUDE.md). If a
 * second screen needs a range picker it should look identical for free.
 */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-1 rounded-lg bg-stone-100 p-1">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition duration-150 ease-out ${
              selected
                ? "bg-white text-stone-900 ring-1 ring-stone-200"
                : "text-stone-500 hover:text-stone-800"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
