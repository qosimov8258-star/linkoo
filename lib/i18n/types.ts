export type LanguageCode = "ru" | "uz" | "tk" | "en"

export const LANGUAGES: LanguageCode[] = ["ru", "uz", "tk", "en"]

export const DEFAULT_LANGUAGE: LanguageCode = "ru"

export const LANGUAGE_COOKIE = "app_lang"

export function isLanguageCode(value: string | undefined | null): value is LanguageCode {
  return value === "ru" || value === "uz" || value === "tk" || value === "en"
}
