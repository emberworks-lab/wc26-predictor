/**
 * Server-side invoker for the deployed sync Edge Function — the SAME endpoint
 * pg_cron hits, so every admin-triggered run flows through sync_log and the
 * snapshot trigger exactly like a scheduled one.
 */

export interface SyncInvocation {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function invokeSyncFunction(
  mode: "fixtures" | "stats" | "recompute",
): Promise<SyncInvocation> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SYNC_SECRET;
  if (!url || !secret) {
    return { ok: false, status: 0, body: { error: "sync env missing" } };
  }
  try {
    const res = await fetch(`${url}/functions/v1/sync?mode=${mode}`, {
      method: "POST",
      headers: { "x-sync-secret": secret, "Content-Type": "application/json" },
      body: "{}",
      // recompute over all entries can take a while on a cold function
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}
