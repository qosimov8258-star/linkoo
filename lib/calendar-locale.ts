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

/** The app's month names per UI language: `long` is the "D MMMM" form (the genitive for ru), `short` the
 * "DD MMM YYYY" one. Explicit tables, because browsers often lack ICU month names for uz-Latn / tk (they print
 * "M10"). One source for the app's own dates: the form calendar (calendarWords) and lib/finance/dates.ts. */
export const MONTH_NAMES: Record<LanguageCode, { long: string[]; short: string[] }> = {
  ru: {
    // The reference app's moment "ru" locale in its "DD MMM YYYY" / "D MMMM" formats (the genitive "format"
    // forms): "06 июля 2026", "23 июня 2026", "05 мая 2026" — Intl ru prints "июл." / "июн." instead.
    long: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
    short: ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."],
  },
  uz: {
    // The reference app's moment "uz" locale (updateLocale).
    long: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentyabr", "oktyabr", "noyabr", "dekabr"],
    short: ["yan", "fev", "mar", "apr", "may", "iyun", "iyul", "avg", "sen", "okt", "noy", "dek"],
  },
  en: {
    // moment "en": Intl en-GB prints "Sept", the reference prints "Sep".
    long: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  },
  tk: {
    long: ["ýanwar", "fewral", "mart", "aprel", "maý", "iýun", "iýul", "awgust", "sentýabr", "oktýabr", "noýabr", "dekabr"],
    short: ["ýan", "few", "mar", "apr", "maý", "iýn", "iýl", "awg", "sen", "okt", "noý", "dek"],
  },
}

// Monday first. `min`: a calendar's header row; `short`: the chosen day's name («Pay, 19 noy»).
const CALENDAR_WEEKDAYS: Record<LanguageCode, { min: string[]; short: string[] }> = {
  ru: { min: ["пн", "вт", "ср", "чт", "пт", "сб", "вс"], short: ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] },
  uz: { min: ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"], short: ["Dush", "Sesh", "Chor", "Pay", "Jum", "Shan", "Yak"] },
  en: { min: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"], short: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  tk: { min: ["Duş", "Siş", "Çar", "Pen", "Ann", "Şen", "Ýek"], short: ["Duş", "Siş", "Çar", "Pen", "Ann", "Şen", "Ýek"] },
}

/** The words of the app's own form calendar (components/analytics/date-picker-dialog.tsx) in the UI language:
 * Latin-script uz and Turkmen tk, as the app shows its dates in the UI language. (The range picker keeps the
 * reference's moment header from weekdayLabels above: Cyrillic uz, Russian tk.) An unknown language gets ru. */
export function calendarWords(language: LanguageCode): { months: string[]; shortMonths: string[]; weekdaysMin: string[]; weekdaysShort: string[] } {
  const months = MONTH_NAMES[language] ?? MONTH_NAMES.ru
  const weekdays = CALENDAR_WEEKDAYS[language] ?? CALENDAR_WEEKDAYS.ru
  return { months: months.long, shortMonths: months.short, weekdaysMin: weekdays.min, weekdaysShort: weekdays.short }
}
