"use client";

import { useEffect, useState } from "react";
import { tenantsApi, Tenant, ApiError } from "@/lib/api";
import { Button, Field, FormError, Input, Modal, useToast } from "@/components/ui";

/**
 * Giving a tenant a way into the portal — or a new one, when they forget.
 *
 * The gap this closes: portal login requires a password hash, and only the
 * public registration form ever wrote one. Every tenant an owner typed in by
 * hand was therefore locked out of `/my` permanently, which made anything
 * portal-only unreachable for them rather than merely awkward. That is why the
 * standing rule is "no capability may be tenant-portal-exclusive", and why this
 * dialog exists on the owner side rather than as a self-serve reset.
 *
 * It sets rather than changes: the owner does not know the old password and
 * should not. The tenant is told the new one out loud, in person, which is
 * exactly how a hostel already works.
 */
export function PortalPasswordDialog({
  open,
  tenant,
  token,
  onSaved,
  onClose,
}: {
  open: boolean;
  tenant: Tenant | null;
  token: string;
  onSaved: (tenant: Tenant) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setConfirm("");
    setReveal(false);
    setError("");
  }, [open]);

  const resetting = Boolean(tenant?.has_portal_login);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const updated = await tenantsApi.setPortalPassword(token, tenant.id, password);
      toast.success(resetting ? "Portal password reset" : "Portal login created");
      onSaved(updated);
    } catch (err) {
      // The server's own words: "password must be at least 6 characters" is
      // more use than "failed to save".
      setError(err instanceof ApiError ? err.message : "Failed to set the password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={resetting ? "Reset portal password" : "Create portal login"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-stone-600">
          {tenant?.name ?? "This tenant"} signs in at <strong>/my</strong> with
          their phone number{tenant ? ` (${tenant.phone})` : ""} and this
          password. Tell it to them — you will not be able to read it back.
        </p>

        <Field label="New password" required hint="At least 6 characters.">
          <Input
            required
            autoFocus
            type={reveal ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 6 characters"
          />
        </Field>

        <Field label="Confirm password" required>
          <Input
            required
            type={reveal ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type it again"
          />
        </Field>

        {/* The owner is typing a password they must then read aloud, so seeing
            it is the point rather than a convenience. */}
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-stone-500">
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          Show password
        </label>

        {error && <FormError>{error}</FormError>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading} disabled={!password || !confirm}>
            {loading ? "Saving…" : resetting ? "Reset password" : "Create login"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
