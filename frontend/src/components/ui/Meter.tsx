/**
 * A horizontal fill bar for a single ratio: a room's occupancy, a month's rent
 * collected against billed. A number you can read at a glance down a column.
 *
 * The app used to draw bar and line charts here (hand-rolled SVG, no charting
 * library). Insights replaced them with tables in Oct 2026: on the iPad every
 * figure in a chart sat behind a hover that a touch screen does not have. If
 * a chart ever comes back, the old `Chart.tsx` is in git history. Keep the
 * no-library rule, and have it measure its container rather than scale a
 * fixed viewBox.
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
