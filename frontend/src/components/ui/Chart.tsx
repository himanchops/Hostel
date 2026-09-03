"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The app's charts, hand-rolled in SVG.
 *
 * Deliberately not a charting library: the frontend has three runtime
 * dependencies, and Recharts alone is larger than all of them together. What
 * these draw — grouped bars and one line — is a couple of hundred lines of
 * SVG, and rolling it keeps the design tokens (stone, indigo, emerald)
 * identical to every other surface instead of theming somebody else's
 * defaults.
 *
 * Charts measure their container rather than declaring a fixed viewBox.
 * The first version hardcoded `viewBox="0 0 280 200"` and let the SVG scale,
 * which preserves aspect ratio — so a 3-month range rendered its bars in a
 * 280px island floating in the middle of a 1000px card. Measuring means the
 * drawing always fills the width it was given.
 */

/** Container width, tracked live. 0 until the first measurement lands. */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}

/** Horizontal scroller for a chart that has a natural minimum width. */
export function ChartScroll({
  minWidth = 560,
  children,
}: {
  minWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}

/** Values a reader can't get from a picture — announced, never drawn. */
function SrValues({ rows }: { rows: string[] }) {
  return (
    <ul className="sr-only">
      {rows.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  );
}

/**
 * The floating readout. Charts show shape; this shows the number, because
 * "roughly two-thirds of a bar" is not an amount anyone can act on.
 */
function Tooltip({
  x,
  width,
  title,
  rows,
}: {
  x: number;
  width: number;
  title: string;
  rows: { label: string; value: string; className: string }[];
}) {
  // Clamped so a tooltip on the first or last column does not hang off the
  // edge of the card.
  const half = 78;
  const left = Math.min(Math.max(x, half), Math.max(half, width - half));

  return (
    <div
      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg bg-stone-900 px-2.5 py-1.5 text-[11px] leading-snug text-white shadow-lg"
      style={{ left }}
    >
      <p className="font-medium">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-1.5 tabular-nums">
          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-sm ${r.className}`} />
          <span className="text-stone-300">{r.label}</span>
          <span className="ml-auto font-medium">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

export type BarPair = {
  label: string;
  /** The lighter, behind-the-scenes value — what was owed. */
  base: number;
  /** The solid value — what actually arrived. */
  value: number;
};

/**
 * Two bars per period: what was expected, and what came in.
 *
 * Grouped rather than overlaid because collections routinely exceed
 * expectations — someone clears three months of arrears in one go — and an
 * overlaid bar has nowhere to put the overflow without lying about the scale.
 */
export function GroupedBarChart({
  data,
  height = 200,
  formatValue,
  formatExact,
  baseLabel = "Expected",
  valueLabel = "Collected",
}: {
  data: BarPair[];
  height?: number;
  /** Compact form, for the axis and the peak label where space is tight. */
  formatValue: (n: number) => string;
  /**
   * Full form for the hover readout. The whole reason to hover is to stop
   * guessing, so "₹1.2L" there would answer the wrong question — it defaults
   * to formatValue only so a caller with no rounding to undo can omit it.
   */
  formatExact?: (n: number) => string;
  baseLabel?: string;
  valueLabel?: string;
}) {
  const exact = formatExact ?? formatValue;
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...data.flatMap((d) => [d.base, d.value]));
  // Capped so three months do not stretch into three lonely bars a third of a
  // metre apart; twelve months still fill whatever they are given.
  const w = Math.max(240, Math.min(measured || 560, data.length * 96));
  const h = height;
  const padB = 26;
  const padT = 8;
  const plot = h - padB - padT;

  const slot = w / data.length;
  const barW = Math.max(8, Math.min(20, slot / 3.4));
  const gap = 4;
  const y = (v: number) => padT + plot - (v / max) * plot;
  const cx = (i: number) => i * slot + slot / 2;

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[11px] text-stone-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-indigo-200" />
          {baseLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-indigo-600" />
          {valueLabel}
        </span>
        <span className="ml-auto tabular-nums text-stone-400">peak {formatValue(max)}</span>
      </div>

      <div ref={ref} className="relative">
        {hover !== null && (
          <Tooltip
            x={cx(hover)}
            width={w}
            title={data[hover].label}
            rows={[
              { label: baseLabel, value: exact(data[hover].base), className: "bg-indigo-300" },
              { label: valueLabel, value: exact(data[hover].value), className: "bg-indigo-500" },
            ]}
          />
        )}

        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={`${valueLabel} against ${baseLabel} by month`}
          onPointerLeave={() => setHover(null)}
        >
          <line x1={0} y1={padT + plot} x2={w} y2={padT + plot}
                stroke="currentColor" className="text-stone-200" strokeWidth={1} />

          {data.map((d, i) => (
            <g key={d.label}>
              <rect x={cx(i) - barW - gap / 2} y={y(d.base)}
                    width={barW} height={Math.max(0, padT + plot - y(d.base))}
                    rx={2} className="fill-indigo-200" />
              <rect x={cx(i) + gap / 2} y={y(d.value)}
                    width={barW} height={Math.max(0, padT + plot - y(d.value))}
                    rx={2} className="fill-indigo-600" />
              <text x={cx(i)} y={h - 8} textAnchor="middle"
                    className={`text-[10px] ${hover === i ? "fill-stone-700" : "fill-stone-400"}`}>
                {d.label}
              </text>
            </g>
          ))}

          {/* Hit targets last so they sit above the bars: a full-height column
              per period, so the readout appears anywhere in the month rather
              than only on a 14px bar. */}
          {data.map((d, i) => (
            <rect key={`hit-${d.label}`} x={i * slot} y={0} width={slot} height={h}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)} />
          ))}
        </svg>
      </div>

      <SrValues rows={data.map(
        (d) => `${d.label}: ${baseLabel} ${exact(d.base)}, ${valueLabel} ${exact(d.value)}`,
      )} />
    </div>
  );
}

export type LinePoint = { label: string; value: number };

/** A percentage over time, drawn on a fixed 0–100 scale. */
export function PercentLineChart({
  data,
  height = 180,
  formatDetail,
}: {
  data: LinePoint[];
  height?: number;
  /** Extra line in the readout — e.g. the bed-nights behind the percentage. */
  formatDetail?: (index: number) => string | undefined;
}) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const w = Math.max(240, Math.min(measured || 560, data.length * 96));
  const h = height;
  const padB = 26;
  const padT = 8;
  const padL = 30;
  const plot = h - padB - padT;

  // Fixed 0–100 rather than fitting the data: an occupancy chart that
  // rescales to its own max makes 40% look like a full house.
  const y = (v: number) => padT + plot - (Math.min(100, Math.max(0, v)) / 100) * plot;
  const x = (i: number) =>
    data.length === 1 ? padL + (w - padL) / 2 : padL + (i * (w - padL - 6)) / (data.length - 1);

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(d.value)}`).join(" ");
  const area = data.length
    ? `${line} L${x(data.length - 1)} ${padT + plot} L${x(0)} ${padT + plot} Z`
    : "";
  const slot = data.length > 1 ? (w - padL) / (data.length - 1) : w;

  return (
    <div>
      <div ref={ref} className="relative">
        {hover !== null && (
          <Tooltip
            x={x(hover)}
            width={w}
            title={data[hover].label}
            rows={[
              {
                label: "Occupied",
                value: `${data[hover].value.toFixed(0)}%`,
                className: "bg-indigo-500",
              },
              ...(formatDetail?.(hover)
                ? [{ label: "Bed-nights", value: formatDetail(hover)!, className: "bg-stone-500" }]
                : []),
            ]}
          />
        )}

        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
             aria-label="Occupancy by month"
             onPointerLeave={() => setHover(null)}>
          {[0, 50, 100].map((tick) => (
            <g key={tick}>
              <line x1={padL} y1={y(tick)} x2={w} y2={y(tick)}
                    stroke="currentColor" className="text-stone-100" strokeWidth={1} />
              <text x={0} y={y(tick) + 3} className="fill-stone-400 text-[10px]">{tick}%</text>
            </g>
          ))}

          {area && <path d={area} className="fill-indigo-500/10" />}
          {data.length > 1 && (
            <path d={line} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                  className="stroke-indigo-600" />
          )}

          {hover !== null && (
            <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + plot}
                  stroke="currentColor" className="text-stone-300" strokeWidth={1}
                  strokeDasharray="3 3" />
          )}

          {data.map((d, i) => (
            <g key={d.label}>
              <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 4.5 : 3}
                      className="fill-indigo-600" />
              <text x={x(i)} y={h - 8} textAnchor="middle"
                    className={`text-[10px] ${hover === i ? "fill-stone-700" : "fill-stone-400"}`}>
                {d.label}
              </text>
            </g>
          ))}

          {data.map((d, i) => (
            <rect key={`hit-${d.label}`} x={x(i) - slot / 2} y={0} width={slot} height={h}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)} />
          ))}
        </svg>
      </div>

      <SrValues rows={data.map((d, i) => {
        const detail = formatDetail?.(i);
        return `${d.label}: ${d.value.toFixed(0)}% occupied${detail ? ` (${detail} bed-nights)` : ""}`;
      })} />
    </div>
  );
}

/**
 * A horizontal fill bar for a single ratio — used per room, where a full chart
 * per row would be noise but a bare percentage is hard to compare down a column.
 */
export function Meter({ percent, tone = "indigo" }: { percent: number; tone?: "indigo" | "emerald" | "amber" }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const fill = { indigo: "bg-indigo-500", emerald: "bg-emerald-500", amber: "bg-amber-500" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
