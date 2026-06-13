/**
 * Brand mark (Stage 9 item 15): a stylized football, gold on the stadium-night
 * theme, replacing the emoji/vibe-coded look. `currentColor` throughout so the
 * caller controls the colour (the header tints it gold). The wordmark text
 * stays in the locale file (Header.wordmark).
 */

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="16" cy="16" r="13.2" />
      {/* central panel */}
      <path
        d="M16 11 L20.76 14.45 L18.94 20.05 L13.06 20.05 L11.24 14.45 Z"
        fill="currentColor"
        stroke="currentColor"
      />
      {/* seams radiating to the edge */}
      <path d="M16 11 V3.2" />
      <path d="M20.76 14.45 L28.5 11.9" />
      <path d="M18.94 20.05 L23.7 26.6" />
      <path d="M13.06 20.05 L8.3 26.6" />
      <path d="M11.24 14.45 L3.5 11.9" />
    </svg>
  );
}

/** Mark + wordmark lockup for the header. */
export default function Brand({ wordmark }: { wordmark: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-gold-400">
      <BrandMark className="size-6 shrink-0" />
      <span className="min-w-0 truncate text-lg font-bold tracking-tight">{wordmark}</span>
    </span>
  );
}
