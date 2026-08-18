"use client";

/**
 * Deterministic per-person colour: the same tenant always gets the same tile,
 * so the grid becomes recognisable by shape and colour before you read a word
 * of it. Hashing the name (rather than the id) keeps it stable across the
 * pending queue, the grid and the tenant page, where ids aren't always to hand.
 */
const AVATAR_COLORS = [
  "bg-indigo-100 text-indigo-700",
  "bg-violet-100 text-violet-700",
  "bg-pink-100 text-pink-700",
  "bg-amber-100 text-amber-700",
  "bg-teal-100 text-teal-700",
  "bg-sky-100 text-sky-700",
];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** "Asha Rao" → "AR", "Meera" → "M". Two letters at most. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  xs: "h-7 w-7 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
};

export function Avatar({
  name,
  photoUrl,
  size = "md",
  className = "",
}: {
  name: string;
  photoUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const dim = SIZES[size];
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        className={`${dim} shrink-0 rounded-full object-cover ${className}`.trim()}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`${dim} ${avatarColor(name)} flex shrink-0 items-center justify-center rounded-full font-bold ${className}`.trim()}
    >
      {initials(name)}
    </div>
  );
}

/** The vacant counterpart: a dashed outline asking to be filled. */
export function EmptyAvatar({ size = "md" }: { size?: keyof typeof SIZES }) {
  return (
    <div
      aria-hidden
      className={`${SIZES[size]} flex shrink-0 items-center justify-center rounded-full border border-dashed border-stone-300 text-stone-400`}
    >
      +
    </div>
  );
}
