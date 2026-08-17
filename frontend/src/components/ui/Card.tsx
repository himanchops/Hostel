"use client";

/**
 * The one card recipe: white surface, rounded-xl, hairline stone ring, no drop
 * shadow (shadows are reserved for overlays — Drawer and Modal). If a page is
 * writing `bg-white ring-1 rounded-xl` by hand, it should be using this.
 */
export function Card({
  title,
  action,
  padding = "md",
  className = "",
  children,
}: {
  title?: React.ReactNode;
  /** Right-hand slot on the title row — usually a Button or link. */
  action?: React.ReactNode;
  padding?: "md" | "none";
  className?: string;
  children?: React.ReactNode;
}) {
  const pad = padding === "none" ? "" : "p-4";
  return (
    <div className={`rounded-xl bg-white ring-1 ring-stone-200 ${pad} ${className}`.trim()}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {typeof title === "string" ? (
            <h2 className="text-base font-semibold text-stone-900">{title}</h2>
          ) : (
            title
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
