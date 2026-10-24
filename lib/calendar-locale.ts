import type { LanguageCode } from "@/lib/i18n/types"

// The reference's calendars take their labels from moment / its own preset tables (see its bundle):
//  - weekdaysMin: ru "пн вт ср чт пт сб вс", uz (Cyrillic locale!) "\u0414\u0443 \u0421\u0435 \u0427\u043e \u041f\u0430 \u0416\u0443 \u0428\u0430 \u042f\u043a", en "Mo Tu We Th Fr Sa Su" (Monday first);
//  - range presets: ru has 5 ("Пред. месяц" too), uz and en only 4.
const WEEKDAYS: Partial<Record<LanguageCode, string[]>> = {
  uz: ["\u0414\u0443", "\u0421\u0435", "\u0427\u043e", "\u041f\u0430", "\u0416\u0443", "\u0428\u0430", "\u042f\u043a"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
}

/** Monday-first weekday header; `fallback` (the Russian labels) is used for ru / tk. */
export function weekdayLabels(language: LanguageCode, fallback: string[]): string[] {
  return WEEKDAYS[language] ?? fallback
}

const PRESET_LABELS: Partial<Record<LanguageCode, string[]>> = {
  uz: ["Bugun", "Kecha", "Oxirgi 7 kun", "Joriy oy"],
  en: ["Today", "Yesterday", "Last 7 days", "Current month"],
}

/** Preset buttons shown for a language: uz / en drop the 5th ("previous month") preset like the reference. */
export function presetLabelFor(language: LanguageCode, index: number, russian: string): string | null {
  const labels = PRESET_LABELS[language]
  if (!labels) return russian
  return labels[index] ?? null
}
