import { getTranslations } from "next-intl/server";

import SyncControls from "@/app/[locale]/(app)/admin/SyncControls";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

const KINDS = ["fixtures", "stats", "recompute"] as const;
const STATUSES = ["ok", "error", "running"] as const;

/**
 * Force sync + job logs (SPEC admin area). sync_log is read through the
 * viewer's OWN client — the is_admin() RLS policy is what makes rows appear,
 * so this page doubles as a live check of that policy.
 */
export default async function AdminSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string }>;
}) {
  const params = await searchParams;
  const kind = (KINDS as readonly string[]).includes(params.kind ?? "") ? params.kind : undefined;
  const status = (STATUSES as readonly string[]).includes(params.status ?? "")
    ? params.status
    : undefined;

  const t = await getTranslations("Admin.sync");
  const supabase = await createClient();

  let query = supabase
    .from("sync_log")
    .select("id, kind, status, started_at, finished_at, detail")
    .order("id", { ascending: false })
    .limit(30);
  if (kind) query = query.eq("kind", kind);
  if (status) query = query.eq("status", status);
  const { data: logs } = await query;

  const filterHref = (k?: string, s?: string) => ({
    pathname: "/admin" as const,
    query: { ...(k ? { kind: k } : {}), ...(s ? { status: s } : {}) },
  });

  const chip = (active: boolean) =>
    [
      "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
      active
        ? "bg-gold-500/20 text-gold-400"
        : "border border-pitch-700 text-text-muted hover:text-text-primary",
    ].join(" ");

  return (
    <div className="flex flex-col gap-4">
      <SyncControls />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">
          {t("logsTitle")}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={filterHref(undefined, status)} className={chip(!kind)}>
            {t("allKinds")}
          </Link>
          {KINDS.map((k) => (
            <Link key={k} href={filterHref(k, status)} className={chip(kind === k)}>
              {k}
            </Link>
          ))}
          <span className="mx-1 text-pitch-700">|</span>
          <Link href={filterHref(kind, undefined)} className={chip(!status)}>
            {t("allStatuses")}
          </Link>
          {STATUSES.map((s) => (
            <Link key={s} href={filterHref(kind, s)} className={chip(status === s)}>
              {s}
            </Link>
          ))}
        </div>

        <ul className="flex flex-col gap-1.5">
          {(logs ?? []).map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-text-muted">#{row.id}</span>
                <span className="font-semibold">{row.kind}</span>
                <span
                  className={
                    row.status === "ok"
                      ? "font-bold text-success"
                      : row.status === "error"
                        ? "font-bold text-danger"
                        : "font-bold text-gold-400"
                  }
                >
                  {row.status}
                </span>
                <span className="ml-auto text-text-muted">
                  {new Date(row.started_at).toLocaleString("en-GB", {
                    timeZone: "UTC",
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  UTC
                </span>
              </div>
              {row.detail != null && (
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-text-muted">
                  {JSON.stringify(row.detail)}
                </pre>
              )}
            </li>
          ))}
          {(logs ?? []).length === 0 && (
            <li className="text-sm text-text-muted">{t("noRows")}</li>
          )}
        </ul>
      </div>
    </div>
  );
}
