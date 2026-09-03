"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { insightsApi, formatCurrency, type InsightsData, type RoomInsight } from "@/lib/api";
import {
  Banner, Button, Card, ChartScroll, Collapsible, EmptyState, GroupedBarChart,
  Meter, PageHeader, PercentLineChart, SegmentedControl, SkeletonCard,
} from "@/components/ui";

const RANGES = [3, 6, 12] as const;

/** ₹ in thousands for axis and legend labels, where the exact rupee is noise. */
function compactRupees(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(1)}L`;
  if (rupees >= 1000) return `₹${Math.round(rupees / 1000)}k`;
  return `₹${Math.round(rupees)}`;
}

export default function InsightsPage() {
  const { token } = useAuth();
  const [months, setMonths] = useState<number>(12);
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (m: number) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        setData(await insightsApi.get(token, m));
      } catch (e) {
        // Never swallow it — an insights page that silently renders zeros is
        // worse than one that says it could not load.
        setError(e instanceof Error ? e.message : "Could not load insights");
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    load(months);
  }, [load, months]);

  const totalCollected = data?.revenue.reduce((s, r) => s + r.collected_paise, 0) ?? 0;
  const totalExpected = data?.revenue.reduce((s, r) => s + r.expected_paise, 0) ?? 0;
  const collectionRate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0;

  const rooms = [...(data?.rooms ?? [])].sort((a, b) => b.percentage - a.percentage);
  const hasRooms = rooms.length > 0;
  // Surfaced in the collapsed summary: a room that earned nothing all window is
  // the finding most worth opening the panel for.
  const neverLet = rooms.filter((r) => r.total_beds > 0 && r.occupied_nights === 0).length;
  const latestOccupancy = data?.occupancy.at(-1)?.percentage;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Insights"
        subtitle={
          data
            ? `${data.from_date} to ${data.to_date} — ${formatCurrency(totalCollected)} collected of ${formatCurrency(totalExpected)} billed (${collectionRate.toFixed(0)}%)`
            : "How the building has been doing"
        }
        actions={
          <SegmentedControl
            ariaLabel="Time range"
            value={months}
            onChange={setMonths}
            options={RANGES.map((r) => ({ value: r as number, label: `${r}m` }))}
          />
        }
      />

      {error && (
        <Banner tone="danger" className="mb-6">
          {error}{" "}
          <button onClick={() => load(months)} className="font-medium underline">
            Retry
          </button>
        </Banner>
      )}

      {loading && !data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {data && (
        <>
          {/* Stacked, not side by side: a 12-month series needs the width, and
              two columns starve both charts until well past 1440px.

              Collected-vs-billed is the headline and never folds. The other two
              do, because this page is read in two different moods — "how did we
              do this month", which is the first chart alone, and "why", which
              is everything else. */}
          <div className="mb-4 grid gap-4">
            <Card title="Collected vs billed">
              <ChartScroll minWidth={Math.max(280, data.revenue.length * 56)}>
                <GroupedBarChart
                  data={data.revenue.map((r) => ({
                    label: r.label,
                    base: r.expected_paise,
                    value: r.collected_paise,
                  }))}
                  formatValue={compactRupees}
                  formatExact={formatCurrency}
                  baseLabel="Billed"
                  valueLabel="Collected"
                />
              </ChartScroll>
              <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
                Hover a month for exact figures. Collected is counted in the
                month the money arrived, so arrears cleared in one payment show
                as a single tall bar.
              </p>
            </Card>
          </div>

          <div className="mb-4">
            <Collapsible
              title="Occupancy"
              summary={latestOccupancy !== undefined ? `now ${latestOccupancy.toFixed(0)}%` : undefined}
            >
              <ChartScroll minWidth={Math.max(280, data.occupancy.length * 56)}>
                <PercentLineChart
                  data={data.occupancy.map((o) => ({ label: o.label, value: o.percentage }))}
                  formatDetail={(i) =>
                    `${data.occupancy[i].occupied_nights}/${data.occupancy[i].available_nights}`
                  }
                />
              </ChartScroll>
              <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
                Measured in bed-nights against today&apos;s bed count, so a
                mid-month move-in counts as the part of the month it filled.
              </p>
            </Collapsible>
          </div>

          <Collapsible
            title="By room"
            defaultOpen={false}
            summary={
              hasRooms
                ? `${rooms.length} rooms${neverLet > 0 ? ` · ${neverLet} never let` : ""}`
                : undefined
            }
          >
            {!hasRooms ? (
              <EmptyState
                title="No rooms yet"
                message="Add a site with rooms and beds, and this table fills in."
                action={
                  <Link href="/sites">
                    <Button size="sm">Go to Sites</Button>
                  </Link>
                }
              />
            ) : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-wide text-stone-400">
                      <th className="px-4 py-2 font-medium">Room</th>
                      <th className="px-4 py-2 font-medium">Beds</th>
                      <th className="px-4 py-2 font-medium">Occupancy</th>
                      <th className="px-4 py-2 text-right font-medium">Empty nights</th>
                      <th className="px-4 py-2 text-right font-medium">Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((r) => (
                      <RoomRow key={r.room_id} room={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Collapsible>
        </>
      )}
    </div>
  );
}

function RoomRow({ room }: { room: RoomInsight }) {
  // Colour by how well the room is filling: this table is scanned down the
  // occupancy column looking for the rooms that are not earning.
  const tone = room.percentage >= 75 ? "emerald" : room.percentage >= 40 ? "indigo" : "amber";

  return (
    <tr className="border-b border-stone-50 last:border-0">
      <td className="px-4 py-3">
        <Link
          href={`/sites/${room.site_id}/grid`}
          className="font-medium text-stone-800 transition duration-150 ease-out hover:text-indigo-600"
        >
          {room.room_name}
        </Link>
        <p className="truncate text-[11px] text-stone-400">{room.site_name}</p>
      </td>
      <td className="px-4 py-3 tabular-nums text-stone-600">{room.total_beds}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 tabular-nums text-stone-700">
            {room.percentage.toFixed(0)}%
          </span>
          <span className="w-24 max-w-full">
            <Meter percent={room.percentage} tone={tone} />
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-stone-500">
        {room.vacant_nights.toLocaleString("en-IN")}
      </td>
      <td className="px-4 py-3 text-right tabular-nums font-medium text-stone-800">
        {formatCurrency(room.collected_paise)}
      </td>
    </tr>
  );
}
