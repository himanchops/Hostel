"use client";

import { useEffect, useState } from "react";

/**
 * Shared plumbing for Drawer and Modal: ESC to close, background scroll lock,
 * and a mounted→entered flip so the panel animates in on first paint instead
 * of appearing already in place.
 */
export function useOverlay(open: boolean, onClose: () => void) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setEntered(true));

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      // Reset on close so the next open animates from off-screen again. This
      // belongs in cleanup, not the effect body — the panel stays mounted
      // between opens, so without it the second open would just appear.
      setEntered(false);
    };
  }, [open, onClose]);

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
      className="rounded-lg p-1.5 text-stone-400 transition duration-150 ease-out hover:bg-stone-100 hover:text-stone-600"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
