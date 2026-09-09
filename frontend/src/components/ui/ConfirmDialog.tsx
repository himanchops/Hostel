"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

export type ConfirmOptions = {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for destructive actions — delete, vacate, reject. */
  tone?: "danger" | "primary";
  /**
   * There is no choice to offer — explain why, and let them dismiss it.
   *
   * Renders a single button and always resolves false, so a caller can await
   * it exactly like a real confirm. This exists because the delete dialogs
   * used to warn that a bed with stay history "cannot be deleted" and then
   * show a red Delete button underneath: the client had no way to know which
   * case it was in, so the only way to find out was to press the button and
   * read the refusal. A dialog that states a rule must not also offer to break
   * it.
   */
  acknowledge?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Replaces window.confirm(). Native dialogs can't be styled, block the whole
 * tab, and are auto-dismissed by Playwright — which silently turned every
 * confirmed action into a no-op in tests.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete this room?", tone: "danger" }))) return;
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function settle(result: boolean) {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={options !== null} onClose={() => settle(false)} title={options?.title}>
        {options?.message && <p className="text-sm text-stone-600">{options.message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          {options?.acknowledge ? (
            <Button variant="secondary" onClick={() => settle(false)}>
              {options.confirmLabel ?? "OK"}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => settle(false)}>
                {options?.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={options?.tone === "danger" ? "danger" : "primary"}
                onClick={() => settle(true)}
              >
                {options?.confirmLabel ?? "Confirm"}
              </Button>
            </>
          )}
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
