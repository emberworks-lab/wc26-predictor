"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { sendMagicLink, signInWithGoogle, type MagicLinkState } from "./actions";

const initialState: MagicLinkState = { status: "idle" };

export default function SignInForm({ urlError }: { urlError?: string }) {
  const t = useTranslations("SignIn");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(sendMagicLink, initialState);

  if (state.status === "sent") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-pitch-700 bg-pitch-800 p-8 text-center">
        <span aria-hidden="true" className="text-3xl">
          📨
        </span>
        <h2 className="text-lg font-bold">{t("sentTitle")}</h2>
        <p className="text-sm text-text-muted">{t("sentBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={signInWithGoogle} className="flex flex-col">
        <input type="hidden" name="locale" value={locale} />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-full border border-pitch-700 bg-pitch-800 px-6 py-3 text-sm font-semibold text-text-primary transition-colors hover:border-gold-500"
        >
          <GoogleMark />
          {t("googleButton")}
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-text-muted">
        <span className="h-px flex-1 bg-pitch-700" aria-hidden="true" />
        {t("or")}
        <span className="h-px flex-1 bg-pitch-700" aria-hidden="true" />
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="locale" value={locale} />
        <label htmlFor="email" className="text-sm font-medium">
          {t("emailLabel")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          className="rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-gold-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-full bg-gold-500 px-6 py-3 text-sm font-semibold text-pitch-950 transition-colors hover:bg-gold-400 disabled:opacity-60"
        >
          {pending ? t("sending") : t("magicLinkButton")}
        </button>
      </form>

      {(state.status === "error" || urlError) && (
        <p role="alert" className="text-center text-sm text-danger">
          {t(`errors.${state.error ?? "generic"}`)}
        </p>
      )}

      <p className="text-center text-xs text-text-muted">{t("hint")}</p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3a7.18 7.18 0 0 1-10.8-3.78H1.27v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.26 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.27a12 12 0 0 0 0 10.8l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A12 12 0 0 0 1.27 6.6l4 3.1A7.17 7.17 0 0 1 12 4.75Z"
      />
    </svg>
  );
}
