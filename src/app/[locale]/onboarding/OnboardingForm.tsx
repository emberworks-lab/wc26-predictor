"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { routing } from "@/i18n/routing";

import { completeOnboarding, type OnboardingState } from "./actions";

const initialState: OnboardingState = { status: "idle" };

export default function OnboardingForm() {
  const t = useTranslations("Onboarding");
  const currentLocale = useLocale();
  const [state, formAction, pending] = useActionState(
    completeOnboarding,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="displayName" className="text-sm font-medium">
          {t("nameLabel")}
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          minLength={3}
          maxLength={20}
          autoComplete="nickname"
          placeholder={t("namePlaceholder")}
          className="rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-gold-500 focus:outline-none"
        />
        <p className="text-xs text-text-muted">{t("nameHint")}</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("localeLabel")}</legend>
        <div className="flex gap-3" role="radiogroup">
          {routing.locales.map((loc) => (
            <label
              key={loc}
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-3 text-sm font-semibold has-checked:border-gold-500 has-checked:bg-pitch-800"
            >
              <input
                type="radio"
                name="locale"
                value={loc}
                defaultChecked={loc === currentLocale}
                className="accent-[#d4af37]"
              />
              {t(`locales.${loc}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-2xl border border-pitch-700 bg-pitch-800 p-4 text-sm">
        <p className="font-semibold text-gold-400">{t("hardcoreTitle")}</p>
        <p className="mt-1 text-text-muted">{t("hardcoreBody")}</p>
      </div>

      {state.status === "error" && (
        <p role="alert" className="text-center text-sm text-danger">
          {t(`errors.${state.error ?? "generic"}`)}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-gold-500 px-6 py-3 text-sm font-semibold text-pitch-950 transition-colors hover:bg-gold-400 disabled:opacity-60"
      >
        {pending ? t("saving") : t("submit")}
      </button>
    </form>
  );
}
