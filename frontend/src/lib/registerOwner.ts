/**
 * Whose registration form a bare `/register` shows, from
 * NEXT_PUBLIC_REGISTER_OWNER_ID. Anything but a plain positive whole number
 * (unset, blank, "4a", "0") is NaN, which the form shows as a link that
 * doesn't work: a typo in a Vercel setting must never send someone's
 * registration to the wrong owner.
 */
export function registerOwnerId(raw: string | undefined): number {
  const value = (raw ?? "").trim();
  if (!/^[1-9]\d*$/.test(value)) return NaN;
  return Number(value);
}
