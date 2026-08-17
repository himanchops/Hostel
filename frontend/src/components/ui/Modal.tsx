"use client";

import { Backdrop, CloseButton, useOverlay } from "./Overlay";

/** Centered overlay for short, focused tasks — assign a bed, confirm an action. */
export function Modal({
  open,
  onClose,
  title,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const entered = useOverlay(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <Backdrop entered={entered} onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className={`flex max-h-full w-full max-w-md flex-col rounded-xl bg-white shadow-xl transition duration-150 ease-out ${
            entered ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
        >
          {title && (
            <div className="flex items-start justify-between gap-3 border-b border-stone-100 p-4">
              <h2 className="text-base font-semibold text-stone-900">{title}</h2>
              <CloseButton onClick={onClose} />
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-stone-100 p-4">{footer}</div>
          )}
        </div>
      </div>
    </div>
  );
}
