"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/auth";
import { authApi, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  Field,
  FormError,
  Input,
  PageHeader,
  useConfirm,
  useToast,
  ShowPassword,
} from "@/components/ui";

/** The server's error strings are lowercase fragments; show them as sentences. */
function sentence(message: string): string {
  const s = message.charAt(0).toUpperCase() + message.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/**
 * The owner's own account: change the password, and end every session.
 *
 * Before this screen (UX audit B3) an owner could neither change nor recover a
 * password, and signing out only forgot this browser's copy of the token — a
 * copied token went on working for its full 24 hours. Both actions here bump
 * the account's token version on the server, which is what actually revokes.
 *
 * Recovering a FORGOTTEN password is still the psql runbook in
 * docs/DEPLOYMENT.md. An emailed reset link needs a mail sender, and this app
 * does not have one; half-building the flow without it would put a "Forgot
 * password?" link on the login page that goes nowhere.
 */
/**
 * Where tenants pay, said once and carried by every WhatsApp reminder. A
 * reminder that said "please pay" and not where meant a second message
 * (owner, Oct 2026). Rent comes by the UPI QR at reception or in cash.
 */
function UpiCard() {
  const { owner, token, updateOwner } = useAuth();
  const toast = useToast();
  const [upi, setUpi] = useState(owner?.upi_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saved = owner?.upi_id ?? "";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setSaving(true);
    try {
      const res = await authApi.setUpi(token, upi.trim());
      updateOwner({ upi_id: res.upi_id ?? undefined });
      setUpi(res.upi_id ?? "");
      toast.success(res.upi_id ? "UPI ID saved. Reminders will include it." : "UPI ID removed from reminders.");
    } catch (err) {
      setError(err instanceof ApiError ? sentence(err.message) : "Could not save the UPI ID.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="UPI ID for reminders">
      <form onSubmit={handleSave} className="space-y-4">
        <Field label="UPI ID" hint="WhatsApp reminders end with “You can pay by UPI to …”. Leave it empty to leave that out.">
          <Input
            value={upi}
            onChange={(e) => setUpi(e.target.value)}
            placeholder="name@bank"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" loading={saving} disabled={upi.trim() === saved}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </Card>
  );
}

export default function AccountPage() {
  const { owner, token, replaceToken, logoutTo } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [endingAll, setEndingAll] = useState(false);

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (next !== again) {
      setError("The two new passwords do not match.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const res = await authApi.changePassword(token, { current_password: current, new_password: next });
      // The change revoked this device's token too; the reply carries its
      // replacement, and without swapping it in the next click signs them out.
      replaceToken(res.token);
      setCurrent("");
      setNext("");
      setAgain("");
      setReveal(false);
      toast.success("Password changed — every other device is signed out");
    } catch (err) {
      setError(err instanceof ApiError ? sentence(err.message) : "Could not change the password.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOutEverywhere() {
    if (!token) return;
    const ok = await confirm({
      title: "Sign out everywhere?",
      message:
        "Every phone, tablet and computer signed in to this account — this one included — will have to sign in again. Use it if a device is lost, or someone else may know your password.",
      confirmLabel: "Sign out everywhere",
      tone: "danger",
    });
    if (!ok) return;
    setEndingAll(true);
    try {
      await authApi.signOutEverywhere(token);
      // Not a toast — it would vanish with the signed-in layout — so the
      // login page says it. A full load rather than logout() + router.replace,
      // whose redirect races the layout's own and loses the query string.
      logoutTo("/login?signed_out=everywhere");
    } catch (err) {
      toast.error(err instanceof ApiError ? sentence(err.message) : "Could not sign out the other devices.");
      setEndingAll(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader title="Account" subtitle={owner ? `${owner.name} · ${owner.email}` : undefined} />

      <div className="max-w-xl space-y-6">
        <UpiCard />

        <Card title="Change password">
          <form onSubmit={handleChange} className="space-y-4">
            <p className="text-sm text-stone-600">
              Changing it signs out every other phone, tablet and computer using
              this account. This one stays signed in.
            </p>

            <Field label="Current password" required>
              <Input
                required
                type={reveal ? "text" : "password"}
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>

            <Field label="New password" required hint="At least 8 characters.">
              <Input
                required
                type={reveal ? "text" : "password"}
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>

            <Field label="Confirm new password" required>
              <Input
                required
                type={reveal ? "text" : "password"}
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
            </Field>

            <ShowPassword checked={reveal} onChange={setReveal} label="Show passwords" />

            {error && <FormError>{error}</FormError>}

            <div className="flex justify-end">
              <Button type="submit" loading={saving} disabled={!current || !next || !again}>
                {saving ? "Changing…" : "Change password"}
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Sign out everywhere">
          <p className="text-sm text-stone-600">
            &ldquo;Sign out&rdquo; only forgets this device. This ends every
            session on every device at once, this one included, without
            changing your password.
          </p>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" loading={endingAll} onClick={handleSignOutEverywhere}>
              Sign out everywhere
            </Button>
          </div>
        </Card>

        <p className="text-[13px] text-stone-400">
          Forgotten passwords cannot be reset by email yet. If you are locked
          out, whoever runs this app for you can reset it.
        </p>
      </div>
    </div>
  );
}
