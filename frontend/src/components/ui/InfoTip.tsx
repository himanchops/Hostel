"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { InfoIcon } from "./icons";
import { TOUCH_TARGET } from "./touch";

const WIDTH = 288;
const GUTTER = 16;

/**
 * An ⓘ that opens a small card of explanation where there is no room for a
 * line of text, such as a table's column heading. A tap opens it, since the
 * iPad has no hover; a tap anywhere else, Escape or a scroll closes it.
 *
 * The card is drawn on the page body at a fixed position, not inside the
 * heading: a table that scrolls sideways would otherwise clip it, and the
 * heading's small capitals would carry into the text. For a line that can
 * sit under its heading, use WithHelp instead.
 */
export function InfoTip({ label, title, children }: {
  /** What the button says to a screen reader: "About occupancy". */
  label: string;
  title?: string;
  children: ReactNode;
}) {
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = at !== null;

  const show = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(WIDTH, window.innerWidth - 2 * GUTTER);
    const centred = r.left + r.width / 2 - width / 2;
    const left = Math.min(Math.max(GUTTER, centred), window.innerWidth - GUTTER - width);
    setAt({ top: r.bottom + 6, left, width });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || button.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    // Capture, so a table scrolling sideways closes it too.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? setAt(null) : show())}
        className={`${TOUCH_TARGET} pointer-coarse:-my-3 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle transition duration-150 ease-out ${open ? "text-indigo-600" : "text-stone-400 hover:text-stone-600"}`}
      >
        <InfoIcon className="h-4 w-4" />
      </button>
      {open && createPortal(
        <div
          ref={card}
          id={id}
          role="note"
          style={{ top: at.top, left: at.left, width: at.width }}
          className="fixed z-50 rounded-lg border border-stone-200 bg-white p-3 text-left text-[13px] leading-snug font-normal normal-case tracking-normal text-stone-600 shadow-lg"
        >
          {title && <p className="mb-1 text-sm font-semibold text-stone-900">{title}</p>}
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
