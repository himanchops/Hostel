/**
 * What a page shows while its data is on the way: a few beds filling in, in
 * the grid's colours, instead of grey bars that read as a stalled page.
 *
 * Nothing appears for the first 800ms, so a warm page, which loads in well
 * under a second, never shows it (the owner asked for exactly that: no loader
 * on every transition). The backend runs on Render's free plan and sleeps
 * after 15 minutes idle, and waking it takes up to 30 seconds. So after 5
 * seconds the loader says that, so a wait looks expected rather than broken.
 *
 * Plain CSS (keyframes in globals.css): the app adds no animation library.
 */
const TILES: { color: string; delay: number }[] = [
  { color: "bg-paid-500", delay: 0 },
  { color: "bg-paid-500", delay: 840 },
  { color: "bg-partial-500", delay: 360 },
  { color: "bg-paid-500", delay: 1200 },
  { color: "bg-stone-300", delay: 600 },
  { color: "bg-paid-500", delay: 120 },
  { color: "bg-overdue-500", delay: 960 },
  { color: "bg-paid-500", delay: 480 },
  { color: "bg-vacating-500", delay: 1320 },
  { color: "bg-paid-500", delay: 240 },
  { color: "bg-stone-300", delay: 720 },
  { color: "bg-paid-500", delay: 1080 },
];

export function PageLoader({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-4 py-16 opacity-0 [animation:appear_200ms_ease-out_800ms_forwards] ${className}`.trim()}
    >
      <div aria-hidden className="grid grid-cols-4 gap-1.5">
        {TILES.map(({ color, delay }, i) => (
          <span
            key={i}
            className={`h-5 w-5 rounded-md ${color} motion-safe:[animation:tile-pop_2.4s_ease-in-out_infinite]`}
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
      <span className="sr-only">Loading</span>
      <p aria-hidden className="text-center opacity-0 [animation:appear_300ms_ease-out_5s_forwards]">
        <span className="block text-sm text-stone-600">Waking the server up…</span>
        <span className="mt-0.5 block text-xs text-stone-400">After a quiet spell this can take up to 30 seconds.</span>
      </p>
    </div>
  );
}
