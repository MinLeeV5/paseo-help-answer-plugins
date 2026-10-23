import { useSyncExternalStore } from "react";
import * as clientSdk from "@getpaseo/plugin/client";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { UiLanguage } from "../shared/contracts";
import { chinese, english, resolveUiLocale, translator, type MessageKey } from "./messages";
import { readLegacyPaseoLocale, subscribeLegacyPaseoLocale } from "./legacy-locale";

type HostText = Parameters<PluginClientContext["addSettingsScreen"]>[0]["title"];
interface MessageSet {
  message(key: MessageKey, options?: Record<string, string | number>): HostText;
}
// COMPAT(paseo-0.12): newer hosts supply reactive message descriptors. Keep
// optional exports behind one check so the same bundle loads on 0.12 as well.
const translations = clientSdk as unknown as {
  defineTranslations?(definition: { resources: Record<string, Record<string, string>> }): MessageSet;
  useTranslation?(messages: MessageSet): { locale: string };
};
const hasHostTranslations = typeof translations.defineTranslations === "function" &&
  typeof translations.useTranslation === "function";

function createMessages(language: UiLanguage): MessageSet {
  if (hasHostTranslations) return translations.defineTranslations!({ resources: language === "auto"
    ? { en: english, zh: chinese, "zh-CN": chinese } : { en: language === "en" ? english : chinese } });
  return { message: (key, options) => translator(resolveUiLocale(language, readLegacyPaseoLocale()))(key, options) };
}

export const messages = createMessages("auto");
const forcedEnglish = createMessages("en");
const forcedChinese = createMessages("zh-CN");

// SDK message descriptors keep persistent host labels reactive to Paseo's locale.
// A single-language resource uses the same SDK fallback for an explicit override.
export function messagesForLanguage(language: UiLanguage) {
  return language === "auto" ? messages : language === "en" ? forcedEnglish : forcedChinese;
}

export function initialPaseoLocale(client: PluginClientContext): string {
  return (client as unknown as { i18n?: { locale?: string } }).i18n?.locale ?? readLegacyPaseoLocale();
}

export function usePaseoLocale(): string {
  // The capability is fixed for this bundle's lifetime, so hook order is stable.
  if (hasHostTranslations) return translations.useTranslation!(messages).locale;
  return useSyncExternalStore(subscribeLegacyPaseoLocale, readLegacyPaseoLocale, () => "en");
}

export function useReplyTranslation(language: UiLanguage = "auto") {
  const paseoLocale = usePaseoLocale();
  const locale = resolveUiLocale(language, paseoLocale);
  return { locale, t: translator(locale) };
}
