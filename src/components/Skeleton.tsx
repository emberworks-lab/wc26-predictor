/** Route-level loading skeleton: title bar + N pulsing content cards. */
export default function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <section aria-busy="true" className="flex animate-pulse flex-col gap-4">
      <div className="h-7 w-44 rounded-lg bg-pitch-800" />
      <div className="flex gap-1.5">
        <div className="h-7 w-20 rounded-full bg-pitch-800" />
        <div className="h-7 w-20 rounded-full bg-pitch-800" />
        <div className="h-7 w-20 rounded-full bg-pitch-800" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 rounded-2xl border border-pitch-700 bg-pitch-800" />
      ))}
    </section>
  );
}
