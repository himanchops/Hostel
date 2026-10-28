/**
 * A page or request named the way a person would group it: "/tenants/:id",
 * not "/tenants/12" and "/tenants/13" as two things. What Sentry calls a
 * transaction or a slow request, so each page's timings land together.
 *
 * The query string is dropped, and with it anything typed into a form that
 * ever travels in an address. Today none does; this keeps it that way for
 * Sentry whatever a future page puts there.
 */
export function routeName(urlOrPath: string): string {
  let path = urlOrPath;
  try {
    path = new URL(urlOrPath, "http://x").pathname;
  } catch {
    path = urlOrPath.split(/[?#]/)[0];
  }
  return path.replace(/\/\d+(?=\/|$)/g, "/:id") || "/";
}
