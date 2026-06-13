import { getTranslations } from "next-intl/server";

import UserRow, { type AdminUserDTO } from "@/app/[locale]/(app)/admin/users/UserRow";
import { createServiceClient } from "@/lib/supabase/service";
import { getAdminUserId } from "@/lib/admin/guard";

/**
 * User moderation (SPEC admin area): ban (RLS hides from boards + blocks
 * writes instantly, auth ban stops sign-ins/refresh; predictions retained),
 * rename (offensive display names), delete entry. Auth emails come via the
 * service client — they are admin-only data, never exposed elsewhere.
 */
export default async function AdminUsersPage() {
  const t = await getTranslations("Admin.users");
  const adminId = await getAdminUserId();
  if (!adminId) return null; // layout already redirects

  const service = createServiceClient();
  const [{ data: profiles }, { data: entries }, { data: challenges }, usersRes] =
    await Promise.all([
      service
        .from("profiles")
        .select("id, display_name, role, banned_at, created_at")
        .order("created_at"),
      service.from("challenge_entries").select("id, user_id, challenge_id, hardcore"),
      service.from("challenges").select("id, kind"),
      service.auth.admin.listUsers({ perPage: 1000 }),
    ]);

  const kindById = new Map((challenges ?? []).map((c) => [c.id, c.kind]));
  const emailById = new Map(usersRes.data.users.map((u) => [u.id, u.email ?? ""]));
  const entriesByUser = new Map<string, { id: string; kind: string; hardcore: boolean }[]>();
  for (const e of entries ?? []) {
    const list = entriesByUser.get(e.user_id) ?? [];
    list.push({ id: e.id, kind: kindById.get(e.challenge_id) ?? "?", hardcore: e.hardcore });
    entriesByUser.set(e.user_id, list);
  }

  const dtos: AdminUserDTO[] = (profiles ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
    email: emailById.get(p.id) ?? "",
    role: p.role,
    bannedAt: p.banned_at,
    createdAt: p.created_at,
    entries: entriesByUser.get(p.id) ?? [],
    isSelf: p.id === adminId,
  }));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-muted">{t("hint")}</p>
      <ul className="flex flex-col gap-1.5">
        {dtos.map((u) => (
          <li key={u.id}>
            <UserRow user={u} />
          </li>
        ))}
      </ul>
    </div>
  );
}
