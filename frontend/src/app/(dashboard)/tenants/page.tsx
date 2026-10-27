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
}

function whereabouts(tenant: Tenant, stays: CollectionRow[], movedOut: CollectionRow[]): Whereabouts {
  const here = stays.find((r) => r.tenant_id === tenant.id);
  if (here) {
    return {
      room: roomLabel(here) || "Booked, no bed yet",
      movedIn: here.start_date ? formatDay(here.start_date) : undefined,
      owes: here.balance_paise,
    };
  }
  const owed = movedOut.find((r) => r.tenant_id === tenant.id)?.balance_paise ?? 0;
  if (tenant.left_on) return { room: `Left ${formatDay(tenant.left_on)}`, owes: owed };
  // Approved and never given a stay.
  return { room: "Not staying", owes: owed };
}

export default function TenantsPage() {
  const { token } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [board, setBoard] = useState<{ stays: CollectionRow[]; moved_out: CollectionRow[] } | null>(null);

  useEffect(() => {
    if (!token) return;
    tenantsApi.list(token).then(setTenants).finally(() => setLoading(false));
    // The list still works without it: names and phones, and no columns.
    paymentsBoardApi.get(token).then(setBoard).catch(() => setBoard(null));
  }, [token]);

  const filtered = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.phone.includes(search)
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
          <div
            aria-hidden
            className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_7.5rem_6rem_1rem] gap-4 border-b border-stone-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-stone-400 sm:grid"
          >
            <span>Name</span>
            <span>Room</span>
            <span>Moved in</span>
            <span className="text-right">Owes</span>
            <span />
          </div>
          <ul className="divide-y divide-stone-100">
            {filtered.map((t) => {
              const w = board ? whereabouts(t, board.stays, board.moved_out) : null;
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
