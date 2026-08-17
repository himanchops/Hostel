"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import {
  collectionsApi,
  staysApi,
  CollectionRow,
  ApiError,
  formatCurrency,
  today,
} from "@/lib/api";
import { duePhrase, nudgeMessage, roomLabel, waLink } from "@/lib/wa";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormError,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "@/components/ui";

export default function CollectionsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    return collectionsApi
      .list(token)
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const totalOwed = rows.reduce((sum, r) => sum + r.balance_paise, 0);

  async function handleRecorded(row: CollectionRow, amount: number) {
    setExpanded(null);
    await load();
    toast.success(`Recorded ${formatCurrency(amount)} from ${row.tenant_name.split(" ")[0]}`);
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Collections"
        subtitle={
          loading
            ? "Who owes you money, and how to chase it"
            : rows.length === 0
              ? "Nothing outstanding"
              : `${rows.length} ${rows.length === 1 ? "tenant owes" : "tenants owe"} ${formatCurrency(totalOwed)}`
        }
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Everyone is paid up 🎉"
          message="No outstanding balances across any of your sites."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <CollectionCard
              key={row.stay_id}
              row={row}
              token={token!}
              expanded={expanded === row.stay_id}
              onToggle={() => setExpanded(expanded === row.stay_id ? null : row.stay_id)}
              onRecorded={(amount) => handleRecorded(row, amount)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionCard({
  row, token, expanded, onToggle, onRecorded,
}: {
  row: CollectionRow;
  token: string;
  expanded: boolean;
  onToggle: () => void;
  onRecorded: (amount: number) => void;
}) {
  const [message, setMessage] = useState(() => nudgeMessage(row));
  const [editingMessage, setEditingMessage] = useState(false);
  const link = waLink(row.phone, message);

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/tenants/${row.tenant_id}`}
              className="font-medium text-stone-900 hover:text-indigo-600"
            >
              {row.tenant_name}
            </Link>
            <Badge tone="neutral">{roomLabel(row) || "No bed assigned"}</Badge>
          </div>
          <p className="mt-1 text-xs tabular-nums text-stone-500">
            {row.site_name && `${row.site_name} · `}
            {formatCurrency(row.rent_amount)}/{row.rent_cycle}
            {" · "}
            {row.last_payment_date
              ? `last paid ${row.last_payment_date}`
              : "never paid"}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-lg font-bold tabular-nums text-red-600">
              {formatCurrency(row.balance_paise)}
            </p>
            <p className="text-xs tabular-nums text-stone-400">{duePhrase(row.days_since_due)}</p>
          </div>

          <div className="flex items-center gap-2">
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-stone-700 ring-1 ring-stone-300 transition duration-150 ease-out hover:bg-stone-50"
                title={`Open WhatsApp to ${row.phone}`}
              >
                <WhatsAppIcon className="h-4 w-4" />
                Nudge
              </a>
            ) : (
              <Link
                href={`/tenants/${row.tenant_id}`}
                className="text-[13px] font-medium text-amber-700 hover:underline"
                title={`"${row.phone}" is not a number WhatsApp can open`}
              >
                Fix phone
              </Link>
            )}
            <Button size="sm" onClick={onToggle}>
              {expanded ? "Cancel" : "Record payment"}
            </Button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-stone-100 px-4 py-3">
          <RecordPaymentForm row={row} token={token} onRecorded={onRecorded} />

          {link && (
            <div>
              {editingMessage ? (
                <div className="space-y-2">
                  <Field label="Message">
                    <Textarea
                      rows={3}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="resize-none"
                    />
                  </Field>
                  <div className="flex gap-2">
                    <a
                      href={waLink(row.phone, message) ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-stone-700 ring-1 ring-stone-300 transition duration-150 ease-out hover:bg-stone-50"
                    >
                      <WhatsAppIcon className="h-4 w-4" />
                      Open WhatsApp
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setMessage(nudgeMessage(row)); setEditingMessage(false); }}
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setEditingMessage(true)}
                  className="text-[13px] text-stone-400 transition duration-150 ease-out hover:text-stone-600"
                >
                  Edit nudge message →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RecordPaymentForm({
  row, token, onRecorded,
}: {
  row: CollectionRow;
  token: string;
  onRecorded: (amount: number) => void;
}) {
  // Prefilled with the whole balance in rupees — the common case is the tenant
  // clearing what they owe, and the owner can overwrite for a part payment.
  const [amount, setAmount] = useState(() => (row.balance_paise / 100).toString());
  const [type, setType] = useState("cash");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const paise = Math.round(parseFloat(amount) * 100);
      await staysApi.addPayment(token, row.stay_id, {
        amount: paise,
        payment_type: type,
        payment_date: date,
        notes: notes || undefined,
      });
      onRecorded(paise);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record payment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <FormError>{error}</FormError>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Amount (₹)">
          <Input
            required
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32"
          />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-auto">
            <option value="cash">Cash</option>
            <option value="online">Online</option>
          </Select>
        </Field>
        <Field label="Date">
          <Input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
          />
        </Field>
        <Field label="Notes">
          <Input
            placeholder="Optional"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-40"
          />
        </Field>
        <Button type="submit" loading={loading}>
          {loading ? "Saving…" : "Save payment"}
        </Button>
      </div>
    </form>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.896 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
