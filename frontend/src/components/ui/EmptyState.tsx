"use client";

/** The dashed-border "nothing here yet" block, with an optional next step. */
export function EmptyState({
  icon,
  title,
  message,
  action,
  compact = false,
}: {
  icon?: React.ReactNode;
  title?: string;
  message: React.ReactNode;
  action?: React.ReactNode;
  /** For empties inside a Card, where the dashed border would double up. */
  compact?: boolean;
}) {
  if (compact) {
    return <p className="text-sm text-stone-400">{message}</p>;
  }
  return (
    <div className="rounded-xl border-2 border-dashed border-stone-200 px-4 py-16 text-center">
      {icon && <div className="mb-3 flex justify-center text-stone-300">{icon}</div>}
      {title && <p className="text-sm font-semibold text-stone-700">{title}</p>}
      <p className="text-sm text-stone-500">{message}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
