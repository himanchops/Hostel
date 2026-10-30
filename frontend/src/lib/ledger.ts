/**
 * Why a site, room or bed cannot be deleted, phrased the way the server
 * phrases it.
 *
 * The server's `occupancyRefusal` is still the enforcement — anything hitting
 * the API directly gets a 409 regardless of what a page thinks. This is the
 * preventive half: with `stay_count` on every row, the page knows the answer
 * before the owner taps, so it can explain instead of offering a button that
 * was always going to fail.
 */
export function ledgerRefusal(kind: "site" | "room" | "bed", stays: number, payments: number) {
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `This ${kind} has ${n(stays, "stay")} and ${n(payments, "payment")} on record. ` +
    `Deleting it would destroy that ledger permanently, so it is not allowed. ` +
    (kind === "site"
      ? `A former tenant's payment history is worth keeping.`
      : `End the stay from the grid instead — a former tenant's payment history is worth keeping.`);
}
