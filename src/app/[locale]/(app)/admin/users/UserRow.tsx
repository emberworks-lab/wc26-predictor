"use client";

import { Flame } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import {
  banUser,
  deleteEntry,
  renameUser,
  unbanUser,
} from "@/app/[locale]/(app)/admin/actions";

export interface AdminUserDTO {
  id: string;
  displayName: string;
  email: string;
  role: string;
  bannedAt: string | null;
  createdAt: string;
  entries: { id: string; kind: string; hardcore: boolean }[];
  isSelf: boolean;
}

export default function UserRow({ user }: { user: AdminUserDTO }) {
  const t = useTranslations("Admin.users");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(user.displayName);

  const run = (fn: () => Promise<{ ok: boolean } & { message?: string }>) => {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setMessage(res.message ?? "error");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{user.displayName}</span>
        <span className="text-[10px] text-text-muted">{user.email}</span>
        {user.role === "admin" && (
          <span className="rounded bg-gold-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-gold-400">
            admin
          </span>
        )}
        {user.bannedAt && (
          <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-danger">
            {t("bannedBadge")}
          </span>
        )}
        <span className="ml-auto text-[10px] text-text-muted">
          {new Date(user.createdAt).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
          })}
        </span>
      </div>

      {user.entries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {user.entries.map((e) => (
            <span
              key={e.id}
              className="flex items-center gap-1.5 rounded-full border border-pitch-700 bg-pitch-800 px-2 py-1 text-[10px] text-text-muted"
            >
              {e.kind}
              {e.hardcore && <Flame className="size-3 text-gold-400" aria-hidden="true" />}
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(t("deleteEntryConfirm", { kind: e.kind }))) {
                    run(() => deleteEntry(e.id));
                  }
                }}
                className="font-bold text-danger hover:text-danger/80 disabled:opacity-50"
                aria-label={t("deleteEntry")}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 rounded-lg border border-pitch-700 bg-pitch-950 px-2 text-sm text-text-primary outline-none focus:border-gold-500/60"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setRenaming(false);
                run(() => renameUser(user.id, name));
              }}
              className="rounded-full bg-gold-500 px-3 py-1.5 text-xs font-semibold text-pitch-950 disabled:opacity-50"
            >
              {t("saveRename")}
            </button>
            <button
              type="button"
              onClick={() => {
                setRenaming(false);
                setName(user.displayName);
              }}
              className="rounded-full border border-pitch-700 px-3 py-1.5 text-xs text-text-muted"
            >
              {t("cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setRenaming(true)}
            className="rounded-full border border-pitch-700 bg-pitch-800 px-3 py-1.5 text-xs font-semibold text-text-primary disabled:opacity-50"
          >
            {t("rename")}
          </button>
        )}

        {!user.isSelf &&
          user.role !== "admin" &&
          (user.bannedAt ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => unbanUser(user.id))}
              className="rounded-full border border-pitch-700 bg-pitch-800 px-3 py-1.5 text-xs font-semibold text-text-primary disabled:opacity-50"
            >
              {t("unban")}
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(t("banConfirm", { name: user.displayName }))) {
                  run(() => banUser(user.id));
                }
              }}
              className="rounded-full bg-danger/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-danger disabled:opacity-50"
            >
              {t("ban")}
            </button>
          ))}
        {message && <span className="text-xs text-danger">{message}</span>}
      </div>
    </div>
  );
}
