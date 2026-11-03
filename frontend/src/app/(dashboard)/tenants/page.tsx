"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { formatCurrency, formatDay, paymentsBoardApi, tenantsApi, type CollectionRow, type Tenant } from "@/lib/api";
import { roomLabel } from "@/lib/wa";
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  PageLoader,
  SearchIcon,
  TOUCH_TARGET,
  UsersIcon,
  buttonClasses,
} from "@/components/ui";

/**
 * Where a tenant is and what they owe, from the Payments screen's own rows so
 * the two cannot disagree. "Since" used to be when the record was typed in,
 * which for the notebook import was one afternoon for everyone (owner, Oct
 * 2026); the list now says the room, when they moved in, and what they owe.
 */
interface Whereabouts {
  room: string;
  movedIn?: string;
  owes: number;
  /** "YYYY-MM-DD" to sort by: when they moved in, or for a leaver when they left. */
  sortDate?: string;
  /** Staying (or booked) sorts above left, which sorts above never stayed. */
  rank: 0 | 1 | 2;
}

function whereabouts(tenant: Tenant, stays: CollectionRow[], movedOut: CollectionRow[]): Whereabouts {
  const here = stays.find((r) => r.tenant_id === tenant.id);
  if (here) {
    return {
      room: roomLabel(here) || "Booked, no bed yet",
      movedIn: here.start_date ? formatDay(here.start_date) : undefined,
      owes: here.balance_paise,
      sortDate: here.start_date?.slice(0, 10),
      rank: 0,
    };
  }
  const owed = movedOut.find((r) => r.tenant_id === tenant.id)?.balance_paise ?? 0;
  if (tenant.left_on) return { room: `Left ${formatDay(tenant.left_on)}`, owes: owed, sortDate: tenant.left_on, rank: 1 };
  // Approved and never given a stay.
  return { room: "Not staying", owes: owed, rank: 2 };
}

/**
 * The list opens newest first (owner, Nov 2026): who moved in last is who
 * the owner is most likely looking for. Not by when the record was made,
 * which for the notebook import was one afternoon for everyone.
 *
 * By date, people staying come first, then people who left (most recently
 * left first), then anyone never given a stay; the direction flips the order
 * inside each group, never the groups. Someone booked from a later day is the
 * newest of all.
 */
type SortKey = "moved" | "name";
interface Sort {
  key: SortKey;
  dir: "asc" | "desc";
}

function sortTenants(tenants: Tenant[], where: Map<number, Whereabouts>, sort: Sort): Tenant[] {
  const byName = (a: Tenant, b: Tenant) => a.name.localeCompare(b.name);
  const flip = sort.dir === "asc" ? 1 : -1;
  return [...tenants].sort((a, b) => {
    if (sort.key === "name") return flip * byName(a, b);
    const wa = where.get(a.id);
    const wb = where.get(b.id);
    if (!wa || !wb) return byName(a, b);
    if (wa.rank !== wb.rank) return wa.rank - wb.rank;
    const da = wa.sortDate ?? "";
    const db = wb.sortDate ?? "";
    if (da !== db) return flip * (da < db ? -1 : 1);
    return byName(a, b);
  });
}

/** A column heading that sorts the list: tap it, tap it again to turn it round. */
function SortButton({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-pressed={active}
      className={`${TOUCH_TARGET} -mx-1 inline-flex items-center gap-1 justify-self-start px-1 text-xs font-semibold uppercase tracking-wide transition duration-150 ease-out ${
        active ? "text-stone-700" : "text-stone-400 hover:text-stone-600"
      }`}
    >
      {label}
      {active && <span aria-hidden>{sort.dir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

export default function TenantsPage() {
  const { token } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [board, setBoard] = useState<{ stays: CollectionRow[]; moved_out: CollectionRow[] } | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "moved", dir: "desc" });

  useEffect(() => {
    if (!token) return;
    // Both before the list shows, so it does not open by name and then jump
    // into date order. The list still works without the board: names and
    // phones, by name, and no columns.
    Promise.allSettled([
      tenantsApi.list(token).then(setTenants),
      paymentsBoardApi.get(token).then(setBoard).catch(() => setBoard(null)),
    ]).finally(() => setLoading(false));
  }, [token]);

  // Newest first by date; A to Z by name. Tapping the active one turns it round.
  function onSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  const where = new Map<number, Whereabouts>();
  if (board) for (const t of tenants) where.set(t.id, whereabouts(t, board.stays, board.moved_out));

  const filtered = sortTenants(
    tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.phone.includes(search)
    ),
    where,
    sort,
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Tenants"
        subtitle="All registered tenants across your properties"
        actions={
          <Link href="/tenants/new" className={buttonClasses()}>
            + Add tenant
          </Link>
        }
      />

      {/* Search */}
      {tenants.length > 0 && (
        <div className="mb-4">
          <Input
            type="search"
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>
      )}

      {/* List */}
      {loading ? (
        <PageLoader />
      ) : filtered.length === 0 ? (
        tenants.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="h-8 w-8" />}
            title="No tenants yet"
            message="Add tenants here, or share your registration link and let them register themselves."
            action={
              <Link href="/tenants/new" className={buttonClasses({ size: "sm" })}>
                + Add tenant
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<SearchIcon className="h-8 w-8" />}
            title="No matches"
            message={`Nothing matches "${search}".`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setSearch("")}>
                Clear search
              </Button>
            }
          />
        )
      ) : (
        // One list for every width, each row a link to the tenant. It was a
        // table above sm, where only a "View →" link at the far right opened
        // anyone; the owner taps the name, the phone, anywhere. The columns
        // that do not fit a phone drop out rather than wrapping.
        <Card padding="none" className="overflow-hidden">
          {/* Name and Moved in sort the list. On a phone, where the room
              and date sit under the name, the row keeps just those two and
              Owes. */}
          <div className="flex items-center gap-4 border-b border-stone-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-stone-400 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_7.5rem_6rem_1rem] sm:px-5 sm:py-3">
            <SortButton label="Name" sortKey="name" sort={sort} onSort={onSort} />
            <span className="hidden sm:block">Room</span>
            {board ? <SortButton label="Moved in" sortKey="moved" sort={sort} onSort={onSort} /> : <span />}
            <span className="ml-auto text-right sm:ml-0">Owes</span>
            <span className="hidden sm:block" />
          </div>
          <ul className="divide-y divide-stone-100">
            {filtered.map((t) => {
              const w = where.get(t.id) ?? null;
              return (
                <li key={t.id}>
                  <Link
                    href={`/tenants/${t.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-sm transition duration-150 ease-out hover:bg-stone-50 active:bg-stone-50 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_7.5rem_6rem_1rem] sm:px-5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-stone-900">{t.name}</span>
                      <span className="block truncate text-[13px] tabular-nums text-stone-500">{t.phone}</span>
                      {/* On a phone the room and move-in date go under the name. */}
                      {w && (
                        <span className="block truncate text-[13px] text-stone-400 sm:hidden">
                          {[w.room, w.movedIn && `since ${w.movedIn}`].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className={`hidden truncate sm:block ${w && w.movedIn ? "text-stone-700" : "text-stone-400"}`}>{w?.room ?? ""}</span>
                    <span className="hidden whitespace-nowrap text-stone-500 sm:block">{w?.movedIn ?? ""}</span>
                    <span className={`text-right tabular-nums ${w && w.owes > 0 ? "font-medium text-overdue-700" : "text-stone-300"}`}>
                      {w ? (w.owes > 0 ? formatCurrency(w.owes) : "—") : ""}
                    </span>
                    <span aria-hidden className="hidden text-stone-300 sm:block">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
