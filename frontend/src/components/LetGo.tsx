"use client";

import { useEffect, useState } from "react";
import { ApiError, LetGo, StayOwed, formatCurrency, formatDay, letGoApi } from "@/lib/api";
import { parseRupees } from "@/lib/settlement";
import { Button, ChoiceList, Field, FormError, Input, Modal, useConfirm, useToast } from "@/components/ui";

/**
 * Letting owed money go (owner, Oct 2026): "they owe ₹10,000, we're letting
 * ₹2,000 go". Rare, so it is a quiet link under what they owe, never a button
 * beside Record payment. It is never a payment: what they owe goes down
 * everywhere, and Collected stays cash (migration 017).
 */
export function LetGoDialog({
  open,
  owing,
  token,
  tenantName,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The stays that owe, from the tenant summary. Usually one. */
  owing: StayOwed[];
  token: string;
  tenantName?: string;
  onClose: () => void;
  onSaved: (letGo: LetGo) => void;
}) {
  const toast = useToast();
  const [stayId, setStayId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const first = tenantName?.trim().split(/\s+/)[0] ?? "They";
  const stay = owing.find((o) => o.stay_id === stayId) ?? null;

  // Opened afresh each time, on the stay that owes the most, with all of it
  // filled in: the owner lowers it to what they are letting go.
  useEffect(() => {
    if (!open) return;
    const most = [...owing].sort((a, b) => b.owed - a.owed)[0];
    setStayId(most?.stay_id ?? null);
    setAmount(most ? String(most.owed / 100) : "");
    setNotes("");
    setError("");
  }, [open, owing]);

  const paise = parseRupees(amount);
  const tooMuch = stay !== null && paise !== null && paise > stay.owed;
  const left = stay !== null && paise !== null && !tooMuch ? stay.owed - paise : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    if (paise === null || paise <= 0) {
      setError("Type how much to let go, like 1000.");
      return;
    }
    if (tooMuch) {
      setError(`They owe ${formatCurrency(stay.owed)}, so that's the most you can let go.`);
      return;
    }
    setError("");
    setSaving(true);
    try {
      const saved = await letGoApi.create(token, stay.stay_id, { amount: paise, notes: notes.trim() || undefined });
      toast.success(`${formatCurrency(paise)} let go`);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Let some go">
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-stone-600">
          {first} won&apos;t owe it any more. It isn&apos;t a payment, so it doesn&apos;t count as collected.
        </p>
        {owing.length > 1 && (
          <ChoiceList
            ariaLabel="Which stay"
            value={stayId === null ? null : String(stayId)}
            onChange={(v) => {
              const o = owing.find((x) => String(x.stay_id) === v);
              setStayId(Number(v));
              if (o) setAmount(String(o.owed / 100));
            }}
            options={owing.map((o) => ({
              value: String(o.stay_id),
              label: `${o.settled ? "Still owed since they left" : "Rent owed"}: ${formatCurrency(o.owed)}`,
            }))}
          />
        )}
        <Field label="How much (₹)">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Note (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Diwali, agreed with family…" />
        </Field>
        {stay && left !== null && paise !== null && paise > 0 && (
          <p className="text-sm font-medium text-stone-700">
            {left === 0
              ? `${first} will owe nothing, instead of ${formatCurrency(stay.owed)}.`
              : `${first} will owe ${formatCurrency(left)} instead of ${formatCurrency(stay.owed)}.`}
          </p>
        )}
        {error && <FormError>{error}</FormError>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!stay}>{saving ? "Saving…" : "Let it go"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** One amount let go, opened from its ledger line: what it was, and Take back. */
export function LetGoSheet({
  letGo,
  token,
  onClose,
  onTakenBack,
}: {
  letGo: LetGo | null;
  token: string;
  onClose: () => void;
  onTakenBack: (id: number) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setError(""), [letGo]);
  if (!letGo) return null;
  const lg = letGo;

  async function takeBack() {
    const ok = await confirm({
      title: `Take back ${formatCurrency(lg.amount)}?`,
      message: "They'll owe it again.",
      confirmLabel: "Take back",
    });
    if (!ok) return;
    setError("");
    setSaving(true);
    try {
      await letGoApi.takeBack(token, lg.id);
      toast.success(`${formatCurrency(lg.amount)} owed again`);
      onTakenBack(lg.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={<span className="tabular-nums">{formatCurrency(lg.amount)} let go · {formatDay(lg.created_at)}</span>}>
      <div className="space-y-4">
        <p className="text-sm text-stone-600">
          Not a payment: it came off what they owed, and isn&apos;t counted as collected.
        </p>
        {lg.notes && <p className="text-sm text-stone-800">“{lg.notes}”</p>}
        {lg.settled ? (
          <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
            The settlement was worked out from this. To take it back, undo the settlement first.
          </p>
        ) : (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={takeBack} loading={saving}>Take back…</Button>
          </div>
        )}
        {error && <FormError>{error}</FormError>}
      </div>
    </Modal>
  );
}

/** The ledger's word for it, muted beside real money. */
export function letGoLabel(lg: LetGo): string {
  return `${formatCurrency(lg.amount)} let go`;
}
