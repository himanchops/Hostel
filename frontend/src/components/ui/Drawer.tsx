"use client";

import { useId } from "react";
import { Backdrop, CloseButton, useOverlay } from "./Overlay";

/**
 * Right-side overlay panel. Closes on ESC or backdrop click; slides in.
 *
 * `header` replaces the plain title row when a panel needs more than a string
 * (the pending review drawer puts an avatar and a back arrow up there).
 */
export function Drawer({
  open,
  onClose,
  title,
  header,
  footer,
  width = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  width?: "md" | "lg";
  children: React.ReactNode;
}) {
  const entered = useOverlay(open, onClose);
  const titleId = useId();
  if (!open) return null;

  const maxWidth = width === "lg" ? "max-w-lg" : "max-w-md";

  return (
    <div className="fixed inset-0 z-40">
      <Backdrop entered={entered} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={header || title ? titleId : undefined}
        className={`absolute inset-y-0 right-0 flex w-full ${maxWidth} flex-col bg-white shadow-xl transition-transform duration-150 ease-out ${
          entered ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {(header || title) && (
          <div className="flex items-start justify-between gap-3 border-b border-stone-100 p-4">
            <div id={titleId} className="min-w-0">
              {header ?? <h2 className="text-base font-semibold text-stone-900">{title}</h2>}
            </div>
            <CloseButton onClick={onClose} />
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="border-t border-stone-100 p-4">{footer}</div>}
      </div>
    </div>
  );
}
