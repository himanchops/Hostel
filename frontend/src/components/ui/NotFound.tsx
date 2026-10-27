"use client";

import Link from "next/link";
import { Button } from "./Button";
import { Card } from "./Card";

/**
 * Something the owner asked for is not there, said out loud. A missing tenant
 * or site used to bounce back to its list without a word, which reads as the
 * app losing track; an unknown address showed the framework's bare 404.
 *
 * `failed` is the other answer: it may be there, but it did not load (the
 * server asleep, a dropped connection). That one offers to try again.
 */
export function NotFound({
  title,
  message,
  href,
  linkLabel,
  failed = false,
  className = "",
}: {
  title: string;
  message: string;
  href: string;
  linkLabel: string;
  failed?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-center p-4 ${className}`.trim()}>
      <Card padding="none" className="w-full max-w-md p-8 text-center">
        <h1 className="font-display text-xl font-bold text-stone-900">{title}</h1>
        <p className="mt-2 text-sm text-stone-500">{message}</p>
        <div className="mt-6 flex justify-center gap-2">
          {failed && <Button onClick={() => window.location.reload()}>Try again</Button>}
          <Link href={href}>
            <Button variant={failed ? "secondary" : "primary"}>{linkLabel}</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
