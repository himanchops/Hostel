"use client";

import { useEffect, useState } from "react";
import { staysApi, Stay, ApiError, today } from "@/lib/api";
import { Button, Field, FormError, Input, Modal, useToast } from "@/components/ui";

/**
 * Recording that a tenant is leaving — and, once the day arrives, answering
 * whether they actually did.
 *
 * Two dates because they are two facts. `notice_date` is when they told you;
 * `expected_end_date` is when they say they are going. Neither ends the stay:
 * only `end_date` does that, and only a human sets it, because tenants overstay
 * and leave early and nothing in a database knows which happened.
 *
 * One component for the tenant page and the grid drawer, because the two
 * surfaces had already drifted once over move-out dates.
 */
export function RecordNoticeDialog({
  open,
  stay,
  token,
  tenantName,
  onSaved,
  onClose,
}: {
  open: boolean;
  stay: Pick<Stay, "id" | "notice_date" | "expected_end_date" | "start_date"> | null;
  token: string;
  tenantName?: string;
  onSaved: (stay: Stay) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [noticeDate, setNoticeDate] = useState(today());
  const [expectedEnd, setExpectedEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reopening on a different stay must not show the previous one's dates.
  useEffect(() => {
    if (!open || !stay) return;
    setNoticeDate(stay.notice_date?.slice(0, 10) ?? today());
    setExpectedEnd(stay.expected_end_date?.slice(0, 10) ?? "");
    setError("");
  }, [open, stay]);

  const editing = Boolean(stay?.notice_date || stay?.expected_end_date);

  // "They're staying" cancels the notice outright: both dates. It used to
  // clear only the leaving date, and a notice date on its own still marks the
  // bed as vacating, so the bed stayed orange and the button looked dead.
  async function cancelNotice() {
    if (!stay) return;
    setError("");
    setLoading(true);
    try {
      const updated = await staysApi.update(token, stay.id, { notice_date: null, expected_end_date: null });
      toast.success("Notice cancelled · they're staying");
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel the notice");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    setError("");
    setLoading(true);
    try {
      const updated = await staysApi.update(token, stay.id, {
        notice_date: noticeDate || null,
        // Empty clears it — that is how "they are staying after all" is said
        // without inventing a date.
        expected_end_date: expectedEnd || null,
      });
      toast.success(
        expectedEnd
          ? `Notice recorded — leaving ${expectedEnd}`
          : "Notice cleared",
      );
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record the notice");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Update notice" : "Record notice"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-stone-600">
          {tenantName ? `${tenantName} is` : "This tenant is"} planning to leave.
          This does not end the stay or free the bed — rent keeps accruing until
          you confirm they have actually gone.
        </p>

        <Field label="When did they tell you?">
          <Input
            type="date"
            value={noticeDate}
            max={today()}
            min={stay?.start_date?.slice(0, 10)}
            onChange={(e) => setNoticeDate(e.target.value)}
          />
        </Field>

        <Field label="When are they leaving?">
          <Input
            type="date"
            value={expectedEnd}
            min={stay?.start_date?.slice(0, 10)}
            onChange={(e) => setExpectedEnd(e.target.value)}
          />
          <p className="mt-1 text-xs text-stone-400">
            Leave blank if they have not said. The bed turns orange as the date
            approaches, then asks you to confirm once it passes.
          </p>
        </Field>

        {error && <FormError>{error}</FormError>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* An explicit control rather than "empty the date boxes": clearing
              a date input is unreliable across browsers, and the alternative
              is recording a departure that never happened to stop the
              reminder. */}
          {editing && (
            <Button type="button" variant="secondary" onClick={cancelNotice} disabled={loading} className="mr-auto">
              They&apos;re staying
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
