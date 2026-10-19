// Client-safe types shared by the three catalog dictionaries of the settings menu:
// "Типы продуктов" (/analytics/product-types), "Ед.измерения" (/analytics/units-of-measure)
// and "Бренд" (/analytics/brands). Products and raw materials store these as TEXT
// (type / subcategory / unit / product_group / sub_unit / brand), so the dictionaries keep
// names unique by fin_key, carry a rename into those columns and refuse a delete while the
// name is used (lib/dictionaries-refs.ts).

/** Where a dictionary entry is used (blocks a delete). `label` is a Russian i18n key. */
export type DictionaryUsage = { table: string; label: string; count: number }

/** Error body of the dictionary APIs. `fields` holds Russian i18n keys per form field. */
export type DictionaryErrorBody = { error?: string; fields?: Record<string, string>; usage?: DictionaryUsage[] }

/** Grid state shared by the three pages (URL ?search, ?ordering, ?page, ?pageSize). */
export type DictionaryListState = { search: string; ordering: string; page: number; pageSize: number }

export const DICTIONARY_PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000] as const

/** Longest side of an uploaded picture (resized in the browser before upload). */
export const DICTIONARY_IMAGE_MAX_SIDE = 800

/** JS twin of the SQL fin_key(): lower-case, trimmed, whitespace (NBSP too) collapsed. */
export function dictionaryKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** "Продукты (3), Сырье (1)" in the UI language. */
export function dictionaryUsageText(usage: DictionaryUsage[], t: (text: string) => string): string {
  return usage.map((item) => `${t(item.label)} (${item.count})`).join(", ")
}
