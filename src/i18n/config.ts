export type AppLanguageSetting = "system" | "zh-CN" | "en-US";
export type AppLocale = "zh-CN" | "en-US";

export const DEFAULT_LANGUAGE_SETTING: AppLanguageSetting = "system";

export function getSystemLanguage(): string {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }

  return "en-US";
}

export function detectPreferredLocale(language?: string | null): AppLocale {
  const normalized = (language || "").trim().toLowerCase();
  return normalized.startsWith("zh") ? "zh-CN" : "en-US";
}

export function resolveAppLocale(
  languageSetting: AppLanguageSetting,
  systemLanguage?: string | null,
): AppLocale {
  if (languageSetting === "system") {
    return detectPreferredLocale(systemLanguage);
  }

  return detectPreferredLocale(languageSetting);
}
