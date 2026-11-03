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

/**
 * The link the Pending page offers to share. The owner this deployment is
 * set up for gets the short `/register` that is on the poster; every other
 * owner gets `/register/:id`, which always works. Empty until the owner has
 * loaded, rather than a link to "/register/undefined".
 */
export function registrationLink(origin: string, ownerId: number | undefined, raw: string | undefined): string {
  if (!origin || !ownerId) return "";
  return registerOwnerId(raw) === ownerId ? `${origin}/register` : `${origin}/register/${ownerId}`;
}
