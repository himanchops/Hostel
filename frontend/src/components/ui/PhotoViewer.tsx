"use client";

import { useRef, useState } from "react";
import { useOverlay } from "./Overlay";
import { TOUCH_TARGET } from "./touch";

/** How far a finger has to drag down before letting go closes the viewer. */
const SWIPE_CLOSE_PX = 80;

/**
 * True for an upload that is a PDF, which an <img> cannot show. ID proofs
 * may be PDFs (upload.go accepts them). The path ends with the stored key,
 * and a signed link puts its query string after it.
 */
export function isPdf(url: string): boolean {
  try {
    return new URL(url, "http://x").pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return url.toLowerCase().split("?")[0].endsWith(".pdf");
  }
}

/**
 * A photo shown full screen, over the page (Nov 2026). The profile photo was
 * a 56px circle that did nothing when tapped, and the ID scans opened in a
 * new Safari tab, which on the iPad meant leaving the app to look at a card.
 *
 * Closes on ×, Escape, a tap outside the photo, or a swipe down. A tap on the
 * photo itself does nothing, so pinching to zoom in on small print never
 * closes it by accident.
 */
export function PhotoViewer({
  src,
  alt,
  caption,
  onClose,
}: {
  /** The photo to show; null keeps the viewer closed. */
  src: string | null;
  alt: string;
  caption?: React.ReactNode;
  onClose: () => void;
}) {
  const entered = useOverlay(!!src, onClose);
  if (!src) return null;
  // Keyed by the photo, so switching from the front of an ID to its back
  // starts again from "loading" rather than showing the old state.
  return <ViewerPanel key={src} src={src} alt={alt} caption={caption} entered={entered} onClose={onClose} />;
}

function ViewerPanel({
  src, alt, caption, entered, onClose,
}: {
  src: string;
  alt: string;
  caption?: React.ReactNode;
  entered: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  // One finger, start to finish. A second finger means a pinch, not a swipe.
  const swipe = useRef<{ y: number; pinched: boolean } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length > 1) {
      if (swipe.current) swipe.current.pinched = true;
      return;
    }
    swipe.current = { y: e.touches[0].clientY, pinched: false };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = swipe.current;
    if (!start || e.touches.length > 0) return; // a finger is still down
    swipe.current = null;
    if (!start.pinched && e.changedTouches[0].clientY - start.y > SWIPE_CLOSE_PX) onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className={`fixed inset-0 z-50 flex flex-col bg-stone-950 transition-opacity duration-150 ease-out ${
        entered ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="flex items-center justify-between gap-3 p-2 pl-4 text-sm text-stone-200">
        <span className="truncate">{caption}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`${TOUCH_TARGET} inline-flex flex-shrink-0 items-center justify-center rounded-lg p-2 text-stone-300 transition duration-150 ease-out hover:bg-white/10 hover:text-white`}
        >
          <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">
        {state === "loading" && <p className="text-sm text-stone-400">Loading photo…</p>}
        {state === "failed" ? (
          // Signed links last an hour, so a page left open longer than that
          // holds a dead one. Reloading signs a fresh link.
          <p role="alert" className="max-w-xs text-center text-sm text-stone-300">
            This photo didn&apos;t load. Reload the page and try again.
          </p>
        ) : (
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            onLoad={() => setState("shown")}
            onError={() => setState("failed")}
            className={`max-h-full max-w-full rounded object-contain ${state === "shown" ? "" : "hidden"}`}
          />
        )}
      </div>
    </div>
  );
}
