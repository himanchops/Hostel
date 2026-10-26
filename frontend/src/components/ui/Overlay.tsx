"use client";

import { useEffect, useRef, useState } from "react";
import { TOUCH_TARGET } from "./touch";

/**
 * The background scroll lock, counted across every open overlay.
 *
 * Each overlay used to save body.overflow on open and put it back on close.
 * With two open at once (the grid's bed drawer, then Move bed over it) the
 * second saved "hidden", and when both closed in the same render the drawer
 * unlocked the page and the modal locked it again. The page then stayed
 * unscrollable, across navigation, until a reload (owner, 26 Oct 2026). A
 * count unlocks only when the last overlay closes.
 */
let locks = 0;
let unlockedOverflow = "";

function lockScroll() {
  if (locks++ === 0) {
    unlockedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}

function unlockScroll() {
  if (locks > 0 && --locks === 0) document.body.style.overflow = unlockedOverflow;
}

/**
 * Shared plumbing for Drawer and Modal: ESC to close, background scroll lock,
 * and a mounted→entered flip so the panel animates in on first paint instead
 * of appearing already in place.
 */
export function useOverlay(open: boolean, onClose: () => void) {
  const [entered, setEntered] = useState(false);
  // Callers pass an inline onClose, new on every render. Reading it through a
  // ref keeps the lock from being released and retaken on each re-render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setEntered(true));

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    lockScroll();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      unlockScroll();
      // Reset on close so the next open animates from off-screen again. This
      // belongs in cleanup, not the effect body — the panel stays mounted
      // between opens, so without it the second open would just appear.
      setEntered(false);
    };
  }, [open]);

  return entered;
}

export function Backdrop({
  entered,
  onClick,
}: {
  entered: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`fixed inset-0 bg-stone-900/40 transition-opacity duration-150 ease-out ${
        entered ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className={`${TOUCH_TARGET} inline-flex items-center justify-center rounded-lg p-1.5 text-stone-400 transition duration-150 ease-out hover:bg-stone-100 hover:text-stone-600`}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
