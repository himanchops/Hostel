"use client";

import type { Payment } from "@/lib/api";
import { Badge } from "@/components/ui";

/**
 * Where a payment stands, in the same words on both sides of the app.
 *
 * Three states, and only one of them is money:
 * - approved — counted. The owner's ledgers say nothing (it is the normal
 *   case); the tenant's says "Confirmed", because to them it is news.
 * - waiting — a tenant's proof the owner has not answered.
 * - not accepted — the owner looked and said no (migration 009). Kept, with
 *   the reason, instead of deleted: the tenant claimed to pay, and both sides
 *   need to see what happened to that claim (UX audit M6).
 */
export function PaymentStatus({ payment, audience }: { payment: Payment; audience: "owner" | "tenant" }) {
  if (payment.rejected_at) return <Badge tone="danger">Not accepted</Badge>;
  if (!payment.is_approved) return <Badge tone="warning">{audience === "owner" ? "Awaiting approval" : "Pending"}</Badge>;
  return audience === "tenant" ? <Badge tone="success">Confirmed</Badge> : null;
}

/** The owner's reason for not accepting, when there is one. */
export function RejectionReason({ payment, className = "" }: { payment: Payment; className?: string }) {
  if (!payment.rejected_at || !payment.rejection_reason) return null;
  return <p className={`text-xs text-red-700 ${className}`.trim()}>“{payment.rejection_reason}”</p>;
}
