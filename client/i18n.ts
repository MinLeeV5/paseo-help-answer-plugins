import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";
import type { UiLanguage } from "../shared/contracts";
import { chinese, english, resolveUiLocale, translator } from "./messages";

export const messages = defineTranslations({ resources: { en: english, zh: chinese, "zh-CN": chinese } });
const forcedEnglish = defineTranslations({ resources: { en: english } });
const forcedChinese = defineTranslations({ resources: { en: chinese } });

// SDK message descriptors keep persistent host labels reactive to Paseo's locale.
// A single-language resource uses the same SDK fallback for an explicit override.
export function messagesForLanguage(language: UiLanguage) {
  return language === "auto" ? messages : language === "en" ? forcedEnglish : forcedChinese;
}

export function useReplyTranslation(language: UiLanguage = "auto") {
  const { locale: paseoLocale } = useTranslation(messages);
  const locale = resolveUiLocale(language, paseoLocale);
  return { locale, t: translator(locale) };
}
