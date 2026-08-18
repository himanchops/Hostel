"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { tenantsApi, Tenant } from "@/lib/api";
import {
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
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
        <EmptyState
          message={tenants.length === 0 ? "No tenants yet." : "No tenants match your search."}
        />
      ) : (
        <>
        {/* Phone: a five-column table at 375px wraps every cell onto two
            lines. Same data, stacked. */}
        <Card padding="none" className="divide-y divide-stone-100 sm:hidden">
          {filtered.map((t) => (
            <Link
              key={t.id}
              href={`/tenants/${t.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition duration-150 ease-out active:bg-stone-50"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-stone-900">{t.name}</p>
                <p className="truncate text-[13px] tabular-nums text-stone-500">
                  {t.phone}
                  {t.email ? ` · ${t.email}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-[13px] text-stone-400">
                {new Date(t.created_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
              </span>
            </Link>
          ))}
        </Card>

        <Card padding="none" className="hidden overflow-hidden sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Phone</th>
                <th className="hidden px-5 py-3 sm:table-cell">Email</th>
                <th className="px-5 py-3">Since</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {filtered.map((t) => (
                <tr key={t.id} className="transition duration-150 ease-out hover:bg-stone-50">
                  <td className="px-5 py-3 font-medium text-stone-900">{t.name}</td>
                  <td className="px-5 py-3 tabular-nums text-stone-600">{t.phone}</td>
                  <td className="hidden px-5 py-3 text-stone-400 sm:table-cell">{t.email || "—"}</td>
                  <td className="px-5 py-3 text-stone-400">
                    {new Date(t.created_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/tenants/${t.id}`}
                      className="text-indigo-600 transition duration-150 ease-out hover:text-indigo-500"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        </>
      )}
    </div>
  );
}
