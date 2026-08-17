"use client";

/** Shared control surface, so every input on every page focuses identically. */
const CONTROL =
  "block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition duration-150 ease-out placeholder:text-stone-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-stone-50 disabled:text-stone-400";

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${className}`.trim()} />;
}

export function Textarea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CONTROL} ${className}`.trim()} />;
}

export function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${CONTROL} ${className}`.trim()}>
      {children}
    </select>
  );
}

/** File picker — same box as the other controls, with a styled browse button. */
export function FileInput({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      type="file"
      className={`block w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-500 outline-none transition duration-150 ease-out file:mr-3 file:rounded file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-indigo-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 ${className}`.trim()}
    />
  );
}

/**
 * Label + control + error, as one unit. The label wraps the control rather
 * than using htmlFor/id so that callers never have to invent ids — clicking
 * the label still focuses the input.
 */
export function Field({
  label,
  error,
  hint,
  required,
  className = "",
  children,
}: {
  label?: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`.trim()}>
      {label && (
        <span className="mb-1 block text-[13px] font-medium text-stone-600">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </span>
      )}
      {children}
      {error && <span className="mt-1 block text-[13px] text-red-600">{error}</span>}
      {hint && !error && <span className="mt-1 block text-[13px] text-stone-400">{hint}</span>}
    </label>
  );
}

/** Inline form-level error banner — the one used above form bodies. */
export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-100">
      {children}
    </div>
  );
}
