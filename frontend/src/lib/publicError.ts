import { ApiError } from "./api";

/**
 * What a page anyone can open says when a request fails: the QR
 * registration form and the tenant sign-in. Their 4xx replies are written as
 * sentences for them (handlers/tenants.go, tenant_auth.go). A 5xx carries the
 * server's own note for the logs, "failed to process password", which is
 * not for a tenant standing in a corridor, and a failed fetch is not the
 * server's fault at all.
 */
export function publicMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status >= 500) return "Something went wrong on our side. Please try again in a minute.";
    return err.message;
  }
  return "Couldn't reach the hostel's server. Check your connection and try again.";
}
