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
          <Button variant="ghost" onClick={() => settle(false)}>
            {options?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={options?.tone === "danger" ? "danger" : "primary"}
            onClick={() => settle(true)}
          >
            {options?.confirmLabel ?? "Confirm"}
          </Button>
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
