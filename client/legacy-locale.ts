// Paseo 0.12 stores the desktop app language here but has no plugin i18n API.
// Read only that preference; never modify the host's settings.
export function legacyPaseoLocale(serialized: string | null, languages: readonly string[]): string {
  const supported = ["ar", "en", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN"];
  try {
    const language: unknown = serialized ? JSON.parse(serialized)?.language : undefined;
    if (typeof language === "string" && supported.includes(language)) return language;
  } catch { /* A missing or unreadable preference follows the system language. */ }
  for (const language of languages) {
    const normalized = language.toLowerCase();
    const base = normalized.split("-", 1)[0];
    if (["ar", "en", "es", "fr", "ja", "ko", "ru"].includes(base)) return base;
    if (normalized === "pt" || normalized === "pt-br") return "pt-BR";
    if (normalized === "zh" || normalized === "zh-cn" || normalized.startsWith("zh-hans")) return "zh-CN";
  }
  return "en";
}

export function readLegacyPaseoLocale(): string {
  const desktop = globalThis as unknown as {
    localStorage?: { getItem(key: string): string | null };
    navigator?: { languages?: readonly string[]; language?: string };
  };
  let serialized: string | null = null;
  try { serialized = desktop.localStorage?.getItem("@paseo:app-settings") ?? null; }
  catch { /* Storage may be unavailable in a restricted browser context. */ }
  return legacyPaseoLocale(serialized, desktop.navigator?.languages ??
    (desktop.navigator?.language ? [desktop.navigator.language] : []));
}

export function subscribeLegacyPaseoLocale(listener: () => void): () => void {
  // Storage events do not fire in the window that changed the preference.
  const timer = setInterval(listener, 1000);
  return () => clearInterval(timer);
}
