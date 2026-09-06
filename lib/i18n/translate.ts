import { en } from "./dictionaries/en"
import { tk } from "./dictionaries/tk"
import { uz } from "./dictionaries/uz"
import type { LanguageCode } from "./types"

const dictionaries: Record<Exclude<LanguageCode, "ru">, Record<string, string>> = {
  uz,
  tk,
  en,
}

// Uses the original Russian source text as the dictionary key, so any string
// that hasn't been translated yet simply falls back to showing the Russian
// original instead of breaking — translations can be filled in incrementally.
export function translate(lang: LanguageCode, text: string): string {
  if (lang === "ru") return text
  return dictionaries[lang][text] ?? text
}
