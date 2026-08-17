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
    <div className="p-8">
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
        <Card padding="none" className="overflow-hidden">
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
      )}
    </div>
  );
}
