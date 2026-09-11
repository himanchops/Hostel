/**
 * The two sessions one browser can hold — an owner's and a tenant's — and the
 * one way to forget both.
 *
 * Signing out of either side clears both (UX audit M8). Front-desk machines are
 * shared: a tester signed the owner out, opened /my, and landed in a tenant's
 * ledger, because owner sign-out removed only its own key. A tenant signing out
 * on the office computer and leaving the owner's session behind is the same
 * mistake the other way round.
 */
export const OWNER_TOKEN_KEY = "hostel_token";
export const TENANT_TOKEN_KEY = "hostel_tenant_token";

export function forgetAllSessions(): void {
  localStorage.removeItem(OWNER_TOKEN_KEY);
  localStorage.removeItem(TENANT_TOKEN_KEY);
}
