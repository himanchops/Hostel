"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import {
  dashboardApi, insightsApi, formatCurrency,
  type InsightsData, type MoneyEntry, type MoneyEntryKind, type MonthDetail,
  type RevenuePoint, type RoomInsight,
} from "@/lib/api";
import { reportError } from "@/lib/reportError";
import {
  Badge, Banner, Button, Card, ChevronIcon, Collapsible, EmptyState,
  Meter, PageHeader, SegmentedControl, SkeletonCard, TOUCH_LINK, TOUCH_TARGET,
  type BadgeTone,
} from "@/components/ui";

/** 1m is "this month so far": the tiles then answer the bank-statement question directly. */
const RANGES = [1, 3, 6, 12] as const;
const RANGE_KEY = "insights:months";

/**
 * Two questions about the same money (backend money.go). Rent measures rent
 * against rent billed; All money is every rupee in, less refunds, which is what
 * the bank and the cash drawer show together. The owner switches between them,
 * so the page remembers the last one on this device.
 */
type View = "rent" | "money";
const VIEW_KEY = "insights:view";

/** Which lines of a month each view lists, so the lines add up to its row. */
const VIEW_KINDS: Record<View, MoneyEntryKind[]> = {
  rent: ["rent", "deposit_to_rent", "advance_returned"],
  money: ["rent", "deposit", "returned"],
};

const KIND: Record<MoneyEntryKind, { label: string; tone: BadgeTone; out: boolean }> = {
  rent: { label: "Rent", tone: "success", out: false },
  deposit: { label: "Deposit", tone: "info", out: false },
  returned: { label: "Returned", tone: "warning", out: true },
  deposit_to_rent: { label: "Paid from deposit", tone: "neutral", out: false },
  advance_returned: { label: "Rent refunded", tone: "warning", out: true },
};

// Spelled out rather than left to toLocaleString, whose en-IN short September
// is "Sept" in one runtime and "Sep" in the next.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function dayName(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Nothing billed and no money moved. */
function isEmpty(r: RevenuePoint): boolean {
  return r.expected_paise === 0 && r.rent_paid_paise === 0 && r.deposits_in_paise === 0
    && r.returned_paise === 0 && r.deposit_to_rent_paise === 0 && r.advance_returned_paise === 0;
}

/** −₹2,000 for money going out. formatCurrency puts the sign after the ₹. */
function signed(paise: number): string {
  return paise < 0 ? `−${formatCurrency(-paise)}` : formatCurrency(paise);
}

export default function InsightsPage() {
  const { token } = useAuth();
  const [months, setMonthsState] = useState<number>(12);
  const [view, setViewState] = useState<View>("rent");
  const [data, setData] = useState<InsightsData | null>(null);
  const [owedNow, setOwedNow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read after mount, never during render: the server has no localStorage, and
  // a first render that disagreed with it would not hydrate. A private window
  // or blocked storage simply keeps the default.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "rent" || saved === "money") setViewState(saved);
      const range = Number(localStorage.getItem(RANGE_KEY));
      if ((RANGES as readonly number[]).includes(range)) setMonthsState(range);
    } catch {
      /* storage unavailable: the defaults stand */
    }
  }, []);

  const setMonths = (m: number) => {
    setMonthsState(m);
    try {
      localStorage.setItem(RANGE_KEY, String(m));
    } catch {
      /* not remembered on this device */
    }
  };

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered on this device, which is all that is lost */
    }
  };

  const load = useCallback(
    async (m: number) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        // "Still owed" is the dashboard's own figure, fetched rather than
        // recomputed, so the two screens cannot disagree about it.
        const [insights, dashboard] = await Promise.all([
          insightsApi.get(token, m),
          dashboardApi.get(token),
        ]);
        setData(insights);
        setOwedNow(dashboard.revenue.overdue_amount);
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

  // Months before the first tenant ever arrived are dropped: twelve rows with
  // a hostel that opened in August would be nine rows of "—". A quiet month
  // after that stays, because a month with no money is itself the news.
  const allMonths = data?.revenue ?? [];
  const firstActive = allMonths.findIndex((r) => !isEmpty(r));
  const revenue = firstActive === -1 ? [] : allMonths.slice(firstActive);
  const sum = (f: (r: RevenuePoint) => number) => revenue.reduce((s, r) => s + f(r), 0);
  const totalCollected = sum((r) => r.collected_paise);
  const totalExpected = sum((r) => r.expected_paise);
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
          revenue.length > 0
            ? `${monthName(revenue[0].month)} to ${monthName(revenue[revenue.length - 1].month)}`
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
          <button onClick={() => load(months)} className={`${TOUCH_TARGET} font-medium underline`}>
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
          <div className="mb-4">
            <SegmentedControl
              ariaLabel="What to count"
              value={view}
              onChange={setView}
              options={[
                { value: "rent" as View, label: "Rent" },
                { value: "money" as View, label: "All money" },
              ]}
            />
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {view === "rent" ? (
              <>
                <Tile
                  label="Rent collected"
                  value={formatCurrency(totalCollected)}
                  note={totalExpected > 0
                    ? `${collectionRate.toFixed(0)}% of ${formatCurrency(totalExpected)} billed`
                    : "nothing billed in this range"}
                />
                <Tile
                  label="Still owed now"
                  value={owedNow === null ? "—" : formatCurrency(owedNow)}
                  note={owedNow ? "chase it from Collections →" : "nobody is behind"}
                  href={owedNow ? "/collections" : undefined}
                />
                <Tile
                  label="Occupancy this month"
                  value={latestOccupancy === undefined ? "—" : `${latestOccupancy.toFixed(0)}%`}
                  note="of bed-nights so far"
                />
              </>
            ) : (
              <>
                <Tile
                  label="Money in, net"
                  value={signed(sum((r) => r.net_in_paise))}
                  note="rent and deposits, cash and online, less refunds"
                />
                <Tile
                  label="Deposits in"
                  value={formatCurrency(sum((r) => r.deposits_in_paise))}
                  note={`${formatCurrency(sum((r) => r.returned_paise))} handed back at move-out`}
                />
                <Tile
                  label="Deposits you hold"
                  value={formatCurrency(data.deposits_held_paise)}
                  note="right now, owed back when people leave"
                />
              </>
            )}
          </div>

          <Card padding="none" className="mb-4 min-w-0">
            {revenue.length === 0 ? (
              <EmptyState
                title="Nothing billed yet"
                message="Once a tenant is placed in a bed, each month's rent and money shows up here."
              />
            ) : (
              token && <MonthTable rows={[...revenue].reverse()} view={view} token={token} />
            )}
          </Card>

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
                      <th className="px-4 py-2 text-right font-medium">Rent collected</th>
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

function Tile({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const body = (
    <Card>
      <p className="text-[13px] text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-stone-900">{value}</p>
      {note && <p className="mt-1 text-xs text-stone-400">{note}</p>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block transition duration-150 ease-out hover:opacity-80">{body}</Link>
  ) : body;
}

/**
 * One row per month, newest first. A table rather than a chart because every
 * figure here is read, not compared by eye — and a chart on a touch screen
 * hides its numbers behind a hover the iPad does not have.
 */
function MonthTable({ rows, view, token }: { rows: RevenuePoint[]; view: View; token: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, MonthDetail | "loading" | { error: string }>>({});

  const toggle = async (month: string) => {
    if (open === month) {
      setOpen(null);
      return;
    }
    setOpen(month);
    if (details[month] && details[month] !== "loading" && !("error" in (details[month] as object))) return;
    setDetails((d) => ({ ...d, [month]: "loading" }));
    try {
      const detail = await insightsApi.month(token, month);
      setDetails((d) => ({ ...d, [month]: detail }));
    } catch (e) {
      reportError(e, { where: "insights month detail" });
      setDetails((d) => ({ ...d, [month]: { error: e instanceof Error ? e.message : "Could not load this month" } }));
    }
  };

  const cols = view === "rent" ? 3 : 5;
  const th = "px-3 py-2 text-right font-medium first:pl-4 first:text-left last:pr-4";
  const td = "px-3 py-3 text-right tabular-nums first:pl-4 first:text-left last:pr-4";
  // On a phone the three parts of the money view fold into a line under the
  // net figure. Scrolling sideways would hide the one column that matters.
  const part = "hidden sm:table-cell";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-100 text-[11px] uppercase tracking-wide text-stone-400">
            <th className={th}>Month</th>
            {view === "rent" ? (
              <>
                <th className={th}>Billed</th>
                <th className={`${th} w-[45%]`}>Collected</th>
              </>
            ) : (
              <>
                <th className={`${th} ${part}`}>Rent</th>
                <th className={`${th} ${part}`}>Deposits in</th>
                <th className={`${th} ${part}`}>Returned</th>
                <th className={th}>Net in</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open === r.month;
            const pct = r.expected_paise > 0 ? (r.collected_paise / r.expected_paise) * 100 : null;
            return (
              <Fragment key={r.month}>
                <tr
                  id={`month-${r.month}`}
                  onClick={() => toggle(r.month)}
                  className="cursor-pointer border-b border-stone-50 transition duration-150 ease-out hover:bg-stone-50"
                >
                  <td className={td}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={(e) => { e.stopPropagation(); toggle(r.month); }}
                      className={`${TOUCH_TARGET} inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-stone-800`}
                    >
                      <ChevronIcon className={`h-3.5 w-3.5 text-stone-400 transition duration-150 ease-out ${isOpen ? "rotate-90" : ""}`} />
                      {monthName(r.month)}
                    </button>
                  </td>
                  {view === "rent" ? (
                    <>
                      <td className={`${td} text-stone-500`}>{r.expected_paise ? formatCurrency(r.expected_paise) : "—"}</td>
                      <td className={td}>
                        <span className="font-medium text-stone-800">{formatCurrency(r.collected_paise)}</span>
                        {pct !== null && <span className="ml-1.5 text-xs text-stone-400">{pct.toFixed(0)}%</span>}
                        {pct !== null && (
                          <span className="ml-auto mt-1.5 block w-full max-w-40 sm:inline-block sm:align-middle">
                            <Meter percent={pct} tone={pct >= 95 ? "emerald" : pct >= 60 ? "indigo" : "amber"} />
                          </span>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className={`${td} ${part} text-stone-600`}>{r.rent_paid_paise ? formatCurrency(r.rent_paid_paise) : "—"}</td>
                      <td className={`${td} ${part} text-stone-600`}>{r.deposits_in_paise ? `+${formatCurrency(r.deposits_in_paise)}` : "—"}</td>
                      <td className={`${td} ${part} text-stone-600`}>{r.returned_paise ? signed(-r.returned_paise) : "—"}</td>
                      <td className={td}>
                        <span className={`font-medium ${r.net_in_paise < 0 ? "text-overdue-700" : "text-stone-800"}`}>{signed(r.net_in_paise)}</span>
                        <span className="block text-[11px] font-normal text-stone-400 sm:hidden">
                          {[
                            r.rent_paid_paise ? `${formatCurrency(r.rent_paid_paise)} rent` : "",
                            r.deposits_in_paise ? `+${formatCurrency(r.deposits_in_paise)} dep.` : "",
                            r.returned_paise ? `${signed(-r.returned_paise)} back` : "",
                          ].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                    </>
                  )}
                </tr>
                {isOpen && (
                  <tr className="border-b border-stone-100 bg-stone-50/60">
                    <td colSpan={cols} className="px-4 py-3">
                      <MonthLines detail={details[r.month]} view={view} row={r} onClose={() => {
                        // Closed from the foot of a long list: bring the month
                        // back on screen, or the owner is left mid-table.
                        setOpen(null);
                        requestAnimationFrame(() =>
                          document.getElementById(`month-${r.month}`)?.scrollIntoView({ block: "nearest" }));
                      }} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Lines shown before "Show all": a month of 45 rent payments is a page of its own. */
const LINES_SHOWN = 10;

function MonthLines({
  detail, view, row, onClose,
}: {
  detail: MonthDetail | "loading" | { error: string } | undefined;
  view: View;
  row: RevenuePoint;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  if (!detail || detail === "loading") return <p className="text-sm text-stone-400">Loading {monthName(row.month)}…</p>;
  if ("error" in detail) return <p className="text-sm text-red-600">{detail.error}</p>;

  const kinds = VIEW_KINDS[view];
  const lines = detail.entries.filter((e) => kinds.includes(e.kind));
  if (lines.length === 0) {
    return <p className="text-sm text-stone-400">Nothing {view === "rent" ? "collected" : "came in or went out"} in {monthName(row.month)}.</p>;
  }
  const value = (e: MoneyEntry) => (KIND[e.kind].out ? -e.amount_paise : e.amount_paise);
  const total = lines.reduce((s, e) => s + value(e), 0);

  // Deposits and refunds first: a month has dozens of rent payments and a
  // handful of these, and the handful is what the owner is looking for. The
  // server's newest-first order holds within each group.
  const ordered = [...lines.filter((e) => e.kind !== "rent"), ...lines.filter((e) => e.kind === "rent")];
  const shown = all ? ordered : ordered.slice(0, LINES_SHOWN);

  return (
    <div>
      {/* The month's figure, already split by kind, before any line is read. */}
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
        {kinds.map((k) => {
          const of = lines.filter((e) => e.kind === k);
          if (of.length === 0) return null;
          const sum = of.reduce((s, e) => s + value(e), 0);
          return (
            <span key={k} className="tabular-nums">
              {KIND[k].label} <span className="text-stone-400">×{of.length}</span>{" "}
              <span className="font-medium text-stone-700">{signed(sum)}</span>
            </span>
          );
        })}
      </div>
      <ul className="divide-y divide-stone-100">
        {shown.map((e, i) => <MoneyLine key={`${e.stay_id}-${e.kind}-${e.date}-${i}`} entry={e} />)}
      </ul>
      {ordered.length > LINES_SHOWN && (
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${ordered.length} lines`}
        </Button>
      )}
      <div className="mt-2 flex items-center justify-between border-t border-stone-200 pt-2 text-xs text-stone-500">
        <button type="button" onClick={onClose} className={`${TOUCH_TARGET} font-medium text-indigo-600`}>
          Close {monthName(row.month)}
        </button>
        <span className="tabular-nums">
          {view === "rent" ? "Collected" : "Net in"}: <span className="font-semibold text-stone-800">{signed(total)}</span>
        </span>
      </div>
    </div>
  );
}

function MoneyLine({ entry: e }: { entry: MoneyEntry }) {
  const kind = KIND[e.kind];
  const place = [e.room_name, e.bed_name].filter(Boolean).join(" · ");
  // One row from sm up. On a phone, two: date, name and amount on top, and
  // the details under the name — `sm:contents` dissolves that second row's
  // wrapper back into the single line.
  return (
    <li className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2 text-sm sm:flex">
      <span className="tabular-nums text-stone-400 sm:w-14 sm:shrink-0">{dayName(e.date)}</span>
      <span className="min-w-0 truncate sm:flex-1">
        <Link
          href={`/tenants/${e.tenant_id}`}
          onClick={(ev) => ev.stopPropagation()}
          className={`${TOUCH_LINK} font-medium text-stone-800 hover:text-indigo-600`}
        >
          {e.tenant_name}
        </Link>
        {place && <span className="ml-2 hidden text-xs text-stone-400 sm:inline">{place}</span>}
      </span>
      <span className={`text-right tabular-nums font-medium sm:order-last sm:w-24 ${kind.out ? "text-overdue-700" : "text-stone-800"}`}>
        {kind.out ? signed(-e.amount_paise) : formatCurrency(e.amount_paise)}
      </span>
      <span className="col-span-2 col-start-2 flex items-center gap-2 text-xs text-stone-400 sm:contents">
        <Badge tone={kind.tone}>{kind.label}</Badge>
        <span className="capitalize sm:w-14">{e.payment_type ?? ""}</span>
        {place && <span className="sm:hidden">{place}</span>}
      </span>
    </li>
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
