/**
 * Brand wordmark (Stage 9 item 24): a clean typographic wordmark, no pictorial
 * logo mark. The text stays in the locale file (Header.wordmark).
 */
export default function Brand({ wordmark }: { wordmark: string }) {
  return (
    <span className="min-w-0 truncate text-lg font-bold tracking-tight text-gold-400">
      {wordmark}
    </span>
  );
}
