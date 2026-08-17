"use client";

/** Shimmer placeholder. Sized by the caller — it is just a tinted block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-stone-200/70 ${className}`.trim()} />;
}

/** A few lines of fake text, last line short like real text. */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/5" : "w-full"}`} />
      ))}
    </div>
  );
}

/** Card-shaped placeholder, for grids of cards during first load. */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl bg-white p-4 ring-1 ring-stone-200 ${className}`.trim()}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-32" />
    </div>
  );
}
