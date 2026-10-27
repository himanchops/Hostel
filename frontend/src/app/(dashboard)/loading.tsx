import { PageLoader } from "@/components/ui";

/**
 * Shown while the next page's code downloads after a tap, which on weak
 * mobile data could leave the old page on screen with no sign the tap
 * registered (owner, Oct 2026). PageLoader stays invisible for its first
 * 800ms, so a quick navigation still shows nothing.
 */
export default function Loading() {
  return <PageLoader className="min-h-[60vh]" />;
}
