"use client";

import Link from "next/link";

export type Crumb = { label: string; href?: string };

/** Top of every dashboard page: optional breadcrumb, title, subtitle, actions. */
export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
  className = "",
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  breadcrumb?: Crumb[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-6 ${className}`.trim()}>
      {breadcrumb && breadcrumb.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-stone-500">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden>/</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="transition duration-150 ease-out hover:text-indigo-600">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-stone-800">{crumb.label}</span>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-stone-900">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-stone-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
