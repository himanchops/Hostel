/**
 * The Pending tab's badge counts what waits on the owner: registrations and
 * payment proofs. It is fetched on every navigation, which left it stale
 * while the owner worked through the queue on the Pending page itself, so
 * every approve and reject announces itself and the layout fetches again.
 */
export const PENDING_CHANGED = "hostel:pending-changed";

export function pendingChanged(): void {
  window.dispatchEvent(new Event(PENDING_CHANGED));
}
