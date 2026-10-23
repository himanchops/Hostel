"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { tenantsApi, Tenant } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  SearchIcon,
  Skeleton,
  UsersIcon,
  buttonClasses,
} from "@/components/ui";

export default function TenantsPage() {
  const { token } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!token) return;
    tenantsApi.list(token).then(setTenants).finally(() => setLoading(false));
  }, [token]);

  const filtered = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.phone.includes(search) ||
      (t.email || "").toLowerCase().includes(search.toLowerCase())
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
            placeholder="Search by name, phone, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>
      )}

      {/* List */}
      {loading ? (
        <Card padding="none" className="overflow-hidden">
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </Card>
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
            className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,2fr)_6rem_1rem] gap-4 border-b border-stone-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-stone-400 sm:grid"
          >
            <span>Name</span>
            <span>Phone</span>
            <span>Email</span>
            <span>Since</span>
            <span />
          </div>
          <ul className="divide-y divide-stone-100">
            {filtered.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tenants/${t.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-sm transition duration-150 ease-out hover:bg-stone-50 active:bg-stone-50 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,2fr)_6rem_1rem] sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-stone-900">{t.name}</span>
                    {/* Phone: the number and email under the name. */}
                    <span className="block truncate text-[13px] tabular-nums text-stone-500 sm:hidden">
                      {t.phone}
                      {t.email ? ` · ${t.email}` : ""}
                    </span>
                  </span>
                  <span className="hidden truncate tabular-nums text-stone-600 sm:block">{t.phone}</span>
                  <span className="hidden truncate text-stone-400 sm:block">{t.email || "—"}</span>
                  <span className="text-[13px] text-stone-400 sm:text-sm">
                    {new Date(t.created_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                  </span>
                  <span aria-hidden className="hidden text-stone-300 sm:block">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
