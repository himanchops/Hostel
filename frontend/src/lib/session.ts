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

/**
 * Where to go after signing in. Only a path on this site: `next` arrives in a
 * URL anyone can craft, and following "//evil.example" or "https://…" would
 * make the login page an open redirect — a phishing link that starts on the
 * real domain.
 */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (next.startsWith("/login") || next.startsWith("/signup")) return null;
  return next;
}
