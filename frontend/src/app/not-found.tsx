import { NotFound } from "@/components/ui";

/**
 * An address that is not a page: a mistyped link, or a bookmark from before
 * a screen moved. The framework's own 404 was a bare line of black text.
 */
export default function PageNotFound() {
  return (
    <div className="min-h-screen bg-stone-50">
      <NotFound
        className="min-h-screen"
        title="There's no page here"
        message="The link may be mistyped, or the page has moved."
        href="/dashboard"
        linkLabel="Go to the dashboard"
      />
    </div>
  );
}
