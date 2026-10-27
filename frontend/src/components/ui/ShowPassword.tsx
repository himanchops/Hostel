"use client";

import { TOUCH_TARGET } from "./touch";

/**
 * "Show password", under the password field of every form that takes one.
 * A checkbox rather than an eye inside the field: it says what it does, and
 * it is the pattern the portal-password dialog started with. The form keeps
 * the state and sets its inputs' type from it.
 */
export function ShowPassword({ checked, onChange, label = "Show password" }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <label className={`${TOUCH_TARGET} flex cursor-pointer items-center gap-2 text-[13px] text-stone-500`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-indigo-600"
      />
      {label}
    </label>
  );
}
