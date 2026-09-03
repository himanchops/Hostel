"use client";

/**
 * The app's charts, hand-rolled in SVG.
 *
 * Deliberately not a charting library: the frontend has three runtime
 * dependencies, and Recharts alone is larger than all of them together. What
 * these draw — grouped bars and one line — is a hundred lines of SVG, and
 * rolling it keeps the design tokens (stone, indigo, emerald) identical to
 * every other surface instead of theming somebody else's defaults.
 *
 * Both charts scale to their container through a viewBox, but a 12-month
 * series is unreadable squeezed into 375px, so callers wrap them in
 * ChartScroll — the chart keeps a sensible minimum width and the container
 * scrolls sideways rather than the page doing it.
 */

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
  baseLabel = "Expected",
  valueLabel = "Collected",
}: {
  data: BarPair[];
  height?: number;
  formatValue: (n: number) => string;
  baseLabel?: string;
  valueLabel?: string;
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.base, d.value]));
  const w = Math.max(data.length * 56, 280);
  const h = height;
  const padB = 26; // room for the month labels
  const padT = 8;
  const plot = h - padB - padT;

  const slot = w / data.length;
  const barW = Math.min(14, slot / 3.4);
  const gap = 4;

  const y = (v: number) => padT + plot - (v / max) * plot;

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

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img"
           aria-label={`${valueLabel} against ${baseLabel} by month`}>
        {/* Baseline only. Gridlines across a 12-bar chart are more ink than
            information; the peak is called out in the legend instead. */}
        <line x1={0} y1={padT + plot} x2={w} y2={padT + plot}
              stroke="currentColor" className="text-stone-200" strokeWidth={1} />

        {data.map((d, i) => {
          const cx = i * slot + slot / 2;
          const baseX = cx - barW - gap / 2;
          const valX = cx + gap / 2;
          return (
            <g key={d.label}>
              <title>{`${d.label} — ${baseLabel} ${formatValue(d.base)}, ${valueLabel} ${formatValue(d.value)}`}</title>
              <rect x={baseX} y={y(d.base)} width={barW} height={Math.max(0, padT + plot - y(d.base))}
                    rx={2} className="fill-indigo-200" />
              <rect x={valX} y={y(d.value)} width={barW} height={Math.max(0, padT + plot - y(d.value))}
                    rx={2} className="fill-indigo-600" />
              <text x={cx} y={h - 8} textAnchor="middle"
                    className="fill-stone-400 text-[10px]">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export type LinePoint = { label: string; value: number };

/** A percentage over time, drawn on a fixed 0–100 scale. */
export function PercentLineChart({
  data,
  height = 180,
}: {
  data: LinePoint[];
  height?: number;
}) {
  const w = Math.max(data.length * 56, 280);
  const h = height;
  const padB = 26;
  const padT = 8;
  const padL = 26;
  const plot = h - padB - padT;

  // Fixed 0–100 rather than fitting the data: an occupancy chart that
  // rescales to its own max makes 40% look like a full house.
  const y = (v: number) => padT + plot - (Math.min(100, Math.max(0, v)) / 100) * plot;
  const x = (i: number) =>
    data.length === 1 ? padL + (w - padL) / 2 : padL + (i * (w - padL)) / (data.length - 1);

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(d.value)}`).join(" ");
  const area = data.length
    ? `${line} L${x(data.length - 1)} ${padT + plot} L${x(0)} ${padT + plot} Z`
    : "";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img"
         aria-label="Occupancy by month">
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

      {data.map((d, i) => (
        <g key={d.label}>
          <circle cx={x(i)} cy={y(d.value)} r={3} className="fill-indigo-600" />
          <title>{`${d.label} — ${d.value.toFixed(0)}% occupied`}</title>
          <text x={x(i)} y={h - 8} textAnchor="middle"
                className="fill-stone-400 text-[10px]">{d.label}</text>
        </g>
      ))}
    </svg>
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
