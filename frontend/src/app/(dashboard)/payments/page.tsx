"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import {
  paymentsBoardApi,
  staysApi,
  CollectionRow,
  PaymentsBoard,
  RecentPayment,
  ApiError,
  formatCurrency,
  formatDay,
  latestPaymentDate,
} from "@/lib/api";
import { dueDay, dueSoon, dueWeekday, localToday, localYesterday } from "@/lib/due";
import { PAY_METHODS, PayMethod, payMethodLabel } from "@/lib/payMethod";
import { nudgeMessage, roomLabel, settledPhrase, waLink } from "@/lib/wa";
import {
  Badge,
  Banner,
  buttonClasses,
  Button,
  Card,
  Collapsible,
  EmptyState,
  Field,
  FormError,
  Input,
  PageHeader,
  RupeeIcon,
  SegmentedControl,
  Skeleton,
  Textarea,
  useToast,
  TOUCH_LINK,
} from "@/components/ui";

/**
 * How many rows each list shows before "Show all". A month of arrears on a
 * 45-bed hostel would otherwise push "Due this week" off the screen. Lists
 * grow in place rather than scrolling inside a box: a scroll area inside a
 * scrolling page traps the finger on an iPad.
 */
const ROWS_SHOWN = 5;
/** Recorded lines are one line each, so more of them fit. */
const RECORDED_SHOWN = 8;

/**
 * Payments — the screen used most. It was Collections, a list of who owes,
 * and a tenant paying on the day had no row: recording the most common
 * payment meant Tenants → find them → Record payment. Now everyone due this
 * week is here too, and anyone else is a search away.
 *
 * Built for catching up as much as for the moment: payments arrive by UPI at
 * any hour with nobody watching, and get entered later from memory. So the
 * date is a tap (Today, Yesterday, or a day), and "Recorded this week" answers
 * "did I already put that in?".
 */
export default function PaymentsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const [board, setBoard] = useState<PaymentsBoard | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    if (!token) return;
    return paymentsBoardApi
      .get(token)
      .then((b) => { setBoard(b); setLoadError(false); })
      // An empty list here reads as "nobody owes anything", which is the one
      // thing a failed request must never say.
      .catch(() => setLoadError(true));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const today = localToday();
  const overdue = board?.stays.filter((r) => r.due_state === "overdue") ?? [];
  const thisWeek = board?.stays.filter((r) => dueSoon(r, today)) ?? [];
  const matches = useMemo(() => search(board?.stays ?? [], query), [board, query]);

  async function handleRecorded(row: CollectionRow, amount: number) {
    setOpen(null);
    setQuery("");
    await load();
    toast.success(`Recorded ${formatCurrency(amount)} from ${row.tenant_name.split(" ")[0]}`);
  }

  const toggle = (id: number) => setOpen(open === id ? null : id);
  const row = (r: CollectionRow) => (
    <PayeeRow
      key={r.stay_id}
      row={r}
      token={token!}
      open={open === r.stay_id}
      onToggle={() => toggle(r.stay_id)}
      onRecorded={(amount) => handleRecorded(r, amount)}
    />
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader title="Payments" subtitle={board ? headline(overdue.length, thisWeek.length) : undefined} />

      {loadError ? (
        <FormError>Could not load payments. Reload the page to try again.</FormError>
      ) : !board ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Anyone not on the lists below: paying early, a second month. */}
          <div className="max-w-md">
            <Input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(null); }}
              placeholder="Who paid? Name or room"
              aria-label="Who paid? Search by name or room"
            />
          </div>

          {query.trim() ? (
            <Section title={`${matches.length} ${matches.length === 1 ? "match" : "matches"}`}>
              {matches.length === 0
                ? [<p key="none" className="px-4 py-3 text-sm text-stone-500">Nobody staying now matches “{query.trim()}”.</p>]
                : matches.map(row)}
            </Section>
          ) : (
            <>
              {board.pending_proofs > 0 && (
                <Banner tone="warning" href="/pending?tab=payments">
                  {board.pending_proofs} {board.pending_proofs === 1 ? "payment" : "payments"} sent from the
                  tenant portal to approve
                  <span className="ml-auto">Review →</span>
                </Banner>
              )}

              {overdue.length === 0 && thisWeek.length === 0 ? (
                <EmptyState
                  icon={<RupeeIcon className="h-8 w-8" />}
                  title="Nobody is due this week"
                  message="Everyone staying is paid up. Search above to record a payment anyway."
                />
              ) : (
                <>
                  {/* An empty list is left out; the subtitle says "Nobody
                      overdue" or "none due this week" in its place. */}
                  {overdue.length > 0 && (
                    <Section title="Overdue" tone="danger" limit={ROWS_SHOWN}>{overdue.map(row)}</Section>
                  )}
                  {thisWeek.length > 0 && (
                    <Section title="Due this week" tone="warning" limit={ROWS_SHOWN}>{thisWeek.map(row)}</Section>
                  )}
                </>
              )}

              <Recorded payments={board.recorded} />

              {/* Settling used to drop these off the list, and the tenant who
                  has already left is the one most likely not to pay (UX audit
                  M12). Folded: they are chased now and then, not every day. */}
              {board.moved_out.length > 0 && (
                <Collapsible
                  title="Moved out — still owes"
                  defaultOpen={false}
                  summary={`${formatCurrency(board.moved_out.reduce((s, r) => s + r.balance_paise, 0))} across ${
                    board.moved_out.length
                  } ${board.moved_out.length === 1 ? "tenant" : "tenants"}`}
                >
                  <div className="-mx-4 divide-y divide-stone-100 border-t border-stone-100">
                    {board.moved_out.map(row)}
                  </div>
                </Collapsible>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function headline(overdue: number, thisWeek: number): string | undefined {
  // The empty card below says it, once.
  if (overdue === 0 && thisWeek === 0) return undefined;
  return [
    overdue > 0 ? `${overdue} overdue` : "Nobody overdue",
    thisWeek > 0 ? `${thisWeek} due this week` : "none due this week",
  ].join(" · ");
}

/** By name or room, ignoring case and the "·" between room and bed. */
function search(stays: CollectionRow[], query: string): CollectionRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return stays.filter((r) => {
    const room = `${r.room_name} ${r.bed_name ?? ""}`.toLowerCase();
    return r.tenant_name.toLowerCase().includes(q) || room.includes(q) || room.replace(" ", "").includes(q.replace(/\s/g, ""));
  });
}

function Section({
  title, tone, limit, children,
}: {
  title: string;
  tone?: "danger" | "warning";
  /** Rows shown before "Show all"; every row when unset. */
  limit?: number;
  children: React.ReactNode[];
}) {
  const [all, setAll] = useState(false);
  const color = tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-800" : "text-stone-700";
  const capped = limit !== undefined && children.length > limit;
  const id = `${title.toLowerCase().replace(/\W+/g, "-")}-heading`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={`mb-2 text-sm font-semibold ${color}`}>
        {title}
        {capped && <span className="ml-1.5 font-normal text-stone-500">{children.length}</span>}
      </h2>
      <Card padding="none">
        <div className="divide-y divide-stone-100">{capped && !all ? children.slice(0, limit) : children}</div>
        {capped && (
          <div className="border-t border-stone-100 px-4 py-2">
            <Button variant="ghost" size="sm" onClick={() => setAll(!all)} aria-expanded={all}>
              {all ? "Show fewer" : `Show all ${children.length}`}
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}

/** One line under the name: since when they owe, or when they are due. */
function whenLine(r: CollectionRow, today: string): string {
  if (r.moved_out) return `Left ${r.end_date ? formatDay(r.end_date) : ""} · ${settledPhrase(r.days_since_due)}`;
  if (!r.due_date) return "";
  switch (r.due_state) {
    case "overdue":
      return `Overdue since ${dueDay(r.due_date)}`;
    case "due_today":
      return "Due today";
    case "paid_ahead":
      return `Paid up to ${dueDay(r.due_date)}`;
    default:
      return dueSoon(r, today) ? `Due ${dueWeekday(r.due_date)}` : `Next due ${dueDay(r.due_date)}`;
  }
}

/** What to prefill: everything they owe, or else the rent coming due. */
function amountDue(r: CollectionRow): number {
  return r.balance_paise > 0 ? r.balance_paise : r.due_paise ?? r.rent_amount;
}

function PayeeRow({
  row, token, open, onToggle, onRecorded,
}: {
  row: CollectionRow;
  token: string;
  open: boolean;
  onToggle: () => void;
  onRecorded: (amount: number) => void;
}) {
  const owes = row.balance_paise > 0;
  const behind = row.moved_out || row.due_state === "overdue";
  const [message, setMessage] = useState(() => nudgeMessage(row));
  const [editingMessage, setEditingMessage] = useState(false);
  // A nudge is a reminder of money owed; nobody is chased for rent due Friday.
  const link = owes ? waLink(row.phone, message) : null;
  const room = roomLabel(row);

  return (
    <div className={open ? "bg-stone-50" : undefined}>
      {/* The name keeps at least 12rem; on a phone the amount and buttons
          wrap beneath it rather than squeezing it into a column. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-48 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <Link
              href={`/tenants/${row.tenant_id}`}
              className={`${TOUCH_LINK} font-medium text-stone-900 hover:text-indigo-600`}
            >
              {row.tenant_name}
            </Link>
            <span className="text-[13px] text-stone-500">
              {row.moved_out ? `was in ${room || "no bed"}` : room || "No bed"}
            </span>
          </p>
          <p className={`text-[13px] tabular-nums ${behind ? "text-red-700" : "text-stone-500"}`}>
            {whenLine(row, localToday())}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <p className={`mr-2 text-lg font-bold tabular-nums ${behind ? "text-red-600" : "text-stone-900"}`}>
            {formatCurrency(amountDue(row))}
          </p>
          {owes && (link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              title={`Open WhatsApp to ${row.phone}`}
            >
              <WhatsAppIcon className="h-4 w-4" />
              Nudge
            </a>
          ) : (
            <Link
              href={`/tenants/${row.tenant_id}`}
              className={`${TOUCH_LINK} text-[13px] font-medium text-amber-700 hover:underline`}
              title={`"${row.phone}" is not a number WhatsApp can open`}
            >
              Fix phone
            </Link>
          ))}
          <Button size="sm" variant={open ? "secondary" : "primary"} onClick={onToggle} aria-expanded={open}>
            {open ? "Cancel" : "Record"}
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          <RecordForm row={row} token={token} onRecorded={onRecorded} />
          {link && (
            editingMessage ? (
              <div className="space-y-2">
                <Field label="Message">
                  <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className="resize-none" />
                </Field>
                <Button variant="ghost" size="sm" onClick={() => { setMessage(nudgeMessage(row)); setEditingMessage(false); }}>
                  Reset message
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setEditingMessage(true)}>
                Edit nudge message
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}

type DayChoice = "today" | "yesterday" | "other";
const DAY_CHOICES: readonly { value: DayChoice; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "other", label: "Another day" },
];

function RecordForm({
  row, token, onRecorded,
}: {
  row: CollectionRow;
  token: string;
  onRecorded: (amount: number) => void;
}) {
  // Everything prefilled, so the common case is one tap: what they owe (or
  // the rent coming due), paid the way they paid last time, today.
  const [amount, setAmount] = useState(() => (amountDue(row) / 100).toString());
  const [method, setMethod] = useState<PayMethod>(row.last_payment_type ?? "cash");
  const [day, setDay] = useState<DayChoice>("today");
  const [otherDate, setOtherDate] = useState(localYesterday());
  const [addingNote, setAddingNote] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const paise = Math.round(parseFloat(amount) * 100);
  const valid = Number.isFinite(paise) && paise > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) { setError("Enter the amount they paid"); return; }
    setError("");
    setSaving(true);
    try {
      await staysApi.addPayment(token, row.stay_id, {
        amount: paise,
        payment_type: method,
        payment_date: day === "today" ? localToday() : day === "yesterday" ? localYesterday() : otherDate,
        notes: notes.trim() || undefined,
      });
      onRecorded(paise);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the payment. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-inset ring-stone-200">
      {error && <FormError>{error}</FormError>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Amount (₹)">
          <Input
            required
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(""); }}
            className="w-32"
          />
        </Field>
        <Labelled label="Paid by">
          <SegmentedControl options={PAY_METHODS} value={method} onChange={setMethod} ariaLabel="Paid by" />
        </Labelled>
        <Labelled label="Paid on">
          <SegmentedControl options={DAY_CHOICES} value={day} onChange={setDay} ariaLabel="Paid on" />
        </Labelled>
        {day === "other" && (
          <Field label="Date">
            <Input
              type="date"
              value={otherDate}
              max={latestPaymentDate()}
              onChange={(e) => setOtherDate(e.target.value)}
              className="w-auto"
            />
          </Field>
        )}
      </div>
      {addingNote ? (
        <Field label="Note">
          <Input autoFocus placeholder="Paid for November" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={saving}>
          {saving ? "Saving…" : valid ? `Save ${formatCurrency(paise)}` : "Save"}
        </Button>
        {!addingNote && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddingNote(true)}>
            + Note
          </Button>
        )}
      </div>
    </form>
  );
}

/** A label above a control that is not a form field (a <label> around a
    button group would forward every tap to its first button). */
function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-[13px] font-medium text-stone-600">{label}</span>
      {children}
    </div>
  );
}

function Recorded({ payments }: { payments: RecentPayment[] }) {
  const [all, setAll] = useState(false);
  if (payments.length === 0) return null;
  const shown = all ? payments : payments.slice(0, RECORDED_SHOWN);
  return (
    <section aria-labelledby="recorded-heading">
      <h2 id="recorded-heading" className="mb-2 text-sm font-semibold text-stone-700">Recorded this week</h2>
      <Card padding="none">
        <ul className="divide-y divide-stone-100">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span aria-hidden className="text-emerald-600">✓</span>
              <span className="min-w-0 flex-1">
                <Link href={`/tenants/${p.tenant_id}`} className="font-medium text-stone-800 hover:text-indigo-600">
                  {p.tenant_name}
                </Link>
                <span className="text-stone-500">
                  {" · "}{payMethodLabel(p.payment_type)}{" · paid "}{dueDay(p.payment_date)}
                </span>
                {p.kind === "deposit" && <Badge tone="info" className="ml-2">Deposit</Badge>}
              </span>
              <span className="font-medium tabular-nums text-stone-900">{formatCurrency(p.amount)}</span>
            </li>
          ))}
        </ul>
        {payments.length > RECORDED_SHOWN && (
          <div className="border-t border-stone-100 px-4 py-2">
            <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${payments.length}`}
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.896 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
