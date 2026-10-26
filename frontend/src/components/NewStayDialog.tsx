"use client";

import { useEffect, useState } from "react";
import { staysApi, ApiError, formatDay, today } from "@/lib/api";
import {
  ARRIVAL_HINT, Arrival, BedPicker, NOTHING_SUGGESTED, PaidSuggestion, PaidToBookFields, PaidToday,
  PaidTodayFields, StayTerms, StayTermsFields, VacantBed, emptyPaidToday, emptyStayTerms,
  paidTodayDate, paidTodayError, paidTodaySuffix, recordPaidToday, stayTermsError, stayTermsPayload,
  suggestedFromTerms,
} from "@/components/StayForm";
import { Button, FormError, Modal, SegmentedControl, useToast } from "@/components/ui";

const ARRIVALS = [
  { value: "now", label: "Moving in" },
  { value: "booking", label: "Booking" },
] as const satisfies readonly { value: Arrival; label: string }[];

/**
 * A new stay for someone already on file: a tenant who left and came back
 * (owner, 24 Oct 2026). It is Add tenant's "Their stay" card, the same pieces
 * from StayForm, without the person, who already exists. A fresh stay with
 * its own deposit; the old ones stay on the page below it.
 */
export function NewStayDialog({
  open,
  tenantId,
  tenantName,
  token,
  onCreated,
  onClose,
}: {
  open: boolean;
  tenantId: number;
  tenantName: string;
  token: string;
  /** Called once the stay exists, even if recording the money then failed. */
  onCreated: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [arrival, setArrival] = useState<"now" | "booking">("now");
  const [bed, setBed] = useState<VacantBed | null>(null);
  const [terms, setTerms] = useState<StayTerms>(emptyStayTerms());
  const [paid, setPaid] = useState<PaidToday>(emptyPaidToday());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setArrival("now");
    setBed(null);
    setTerms(emptyStayTerms());
    setPaid(emptyPaidToday());
    setError("");
  }, [open]);

  const suggested: PaidSuggestion = arrival === "booking" ? NOTHING_SUGGESTED : suggestedFromTerms(terms);
  const paidDate = arrival === "booking" ? today() : paidTodayDate(terms);
  const suffix = paidTodaySuffix(paid, suggested);

  function chooseArrival(next: "now" | "booking") {
    setArrival(next);
    setPaid(emptyPaidToday());
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (arrival === "now" && !bed) { setError("Pick a bed, or choose “Booking”."); return; }
    const invalid = stayTermsError(terms) || paidTodayError(paid, suggested);
    if (invalid) { setError(invalid); return; }
    setLoading(true);
    try {
      const stay = await staysApi.create(token, {
        tenant_id: tenantId,
        ...(arrival === "now" && bed ? { bed_id: bed.id } : {}),
        ...stayTermsPayload(terms),
      });
      const done = arrival === "now" && bed
        ? `${tenantName} is back, in ${bed.roomName} · ${bed.name}`
        : `${tenantName} booked from ${formatDay(terms.startDate)}`;
      const missed = await recordPaidToday(token, stay.id, paid, suggested, paidDate);
      if (missed) toast.error(`${done}. ${missed}`);
      else toast.success(done + suffix);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start the stay");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`New stay for ${tenantName}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <SegmentedControl options={ARRIVALS} value={arrival} onChange={chooseArrival} ariaLabel="Their stay" />
          <p className="mt-2 text-[13px] text-stone-500">{ARRIVAL_HINT[arrival]}</p>
        </div>
        {arrival === "now" && <BedPicker token={token} value={bed} onChange={setBed} />}
        <StayTermsFields
          value={terms}
          onChange={setTerms}
          startLabel={arrival === "booking" ? "Arriving on" : "Start date"}
        />
        {arrival === "now" ? (
          <PaidTodayFields value={paid} onChange={setPaid} suggested={suggested} date={paidDate} cycle={terms.cycle} />
        ) : (
          <PaidToBookFields value={paid} onChange={setPaid} cycle={terms.cycle} />
        )}

        {error && <FormError>{error}</FormError>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? "Saving…" : arrival === "now" ? `Move in${suffix}` : `Add booking${suffix}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
