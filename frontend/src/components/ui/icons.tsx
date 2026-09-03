"use client";

/**
 * The app's line icons, in one place. They had started to duplicate — a bed and
 * a rupee lived in both the grid and the dashboard — and an icon that differs
 * by a stroke width between two screens looks like a bug.
 *
 * All of them take a className and inherit currentColor, so callers size and
 * colour them at the usage site.
 */
type IconProps = { className?: string };

function Line({ d, className }: IconProps & { d: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export const GridIcon = (p: IconProps) => <Line {...p} d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />;
export const BuildingIcon = (p: IconProps) => <Line {...p} d="M3 21h18M9 21V7l6-4v18M9 11h6M9 15h6" />;
export const UsersIcon = (p: IconProps) => <Line {...p} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />;
// The bowl closes back onto the stem and the leg descends from it, which is
// what makes this read as ₹ rather than as a 3. An earlier path left the
// stem out entirely, so the two bars plus a free-floating lobe scanned as a
// struck-through numeral in the sidebar.
export const RupeeIcon = (p: IconProps) => <Line {...p} d="M6 3h12M6 8h12M9 13c6.5 0 6.5-10 0-10M9 13H6l8.5 8" />;
export const ClockIcon = (p: IconProps) => <Line {...p} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />;
export const BedIcon = (p: IconProps) => <Line {...p} d="M3 18v-6a2 2 0 012-2h14a2 2 0 012 2v6M3 18v2M21 18v2M3 12V7m4 3V9a1 1 0 011-1h3a1 1 0 011 1v1" />;
export const AlertIcon = (p: IconProps) => <Line {...p} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />;
export const FilterIcon = (p: IconProps) => <Line {...p} d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />;
export const SearchIcon = (p: IconProps) => <Line {...p} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" />;
export const InboxIcon = (p: IconProps) => <Line {...p} d="M3 13h4l2 3h6l2-3h4M5 5h14l2 8v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4l2-8z" />;
export const ReceiptIcon = (p: IconProps) => <Line {...p} d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6" />;
export const DoorIcon = (p: IconProps) => <Line {...p} d="M4 21h16M6 21V4a1 1 0 011-1h10a1 1 0 011 1v17M14 12h.01" />;
