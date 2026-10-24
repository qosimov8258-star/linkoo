// Date helpers shared by the finance server code and the balance UI. Money
// rows store dates in several formats (ISO dates, UTC ISO timestamps,
// `datetime('now')` UTC text, Russian "08 октября 2026, 22:08" / "08 окт.
// 2026 г., 14:05", "08.10.2026"). Business days are counted in Asia/Tashkent.
// The SQL twin of parseAnyDate is fin_ts() in lib/finance/schema.ts.

export const FINANCE_TIME_ZONE = "Asia/Tashkent"
/** Asia/Tashkent has no DST: UTC+5 all year. */
const TZ_OFFSET_MINUTES = 5 * 60

const RU_MONTHS: Record<string, number> = {
  "янв": 1,
  "фев": 2,
  "мар": 3,
  "апр": 4,
  "мая": 5,
  "май": 5,
  "июн": 6,
  "июл": 7,
  "авг": 8,
  "сен": 9,
  "окт": 10,
  "ноя": 11,
  "дек": 12,
}

const pad = (value: number) => String(value).padStart(2, "0")

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function localParts(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): string | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return null
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`
}

function utcToLocal(utcMs: number): string {
  const local = new Date(utcMs + TZ_OFFSET_MINUTES * 60_000)
  return localParts(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()) ?? ""
}

/** Parses any stored date text into a local "YYYY-MM-DDTHH:mm:ss" string, or
 * null. `utc` = treat a zone-less "YYYY-MM-DD HH:MM:SS" as UTC (created_at /
 * updated_at columns); otherwise zone-less values are local business times. */
export function parseAnyDate(value: string | null | undefined, utc = false): string | null {
  const text = String(value ?? "").replace(/[\u00a0\u202f]/g, " ").trim()
  if (!text) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(text)
  if (iso) {
    const [, y, mo, d, h, mi, s, zone] = iso
    const parts = [Number(y), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0)] as const
    if (!localParts(...parts)) return null
    if (zone || (utc && h !== undefined)) {
      let offset = 0
      if (zone && zone.toUpperCase() !== "Z") {
        const sign = zone.startsWith("-") ? -1 : 1
        const digits = zone.slice(1).replace(":", "")
        offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0))
      }
      const utcMs = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]) - offset * 60_000
      return utcToLocal(utcMs)
    }
    return localParts(...parts)
  }

  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
  if (dotted) {
    const [, d, mo, y, h, mi, s] = dotted
    return localParts(Number(y), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0))
  }

  const russian = /^(\d{1,2})\s+([^\s\d.,]+)\.?\s+(\d{4})(?:\s*г\.?)?(?:\s*,?\s*(\d{1,2}):(\d{2}))?/i.exec(text)
  if (russian) {
    const [, d, word, y, h, mi] = russian
    const month = RU_MONTHS[word.toLowerCase().slice(0, 3)]
    if (!month) return null
    return localParts(Number(y), month, Number(d), Number(h ?? 0), Number(mi ?? 0))
  }
  return null
}

/** Local business day "YYYY-MM-DD" of any stored date text, or null. */
export function parseAnyDay(value: string | null | undefined, utc = false): string | null {
  return parseAnyDate(value, utc)?.slice(0, 10) ?? null
}

export function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseAnyDate(value) !== null
}

/** Today in Asia/Tashkent as "YYYY-MM-DD". */
export function todayIso(now = new Date()): string {
  return utcToLocal(now.getTime()).slice(0, 10)
}

/** Current Asia/Tashkent date-time "YYYY-MM-DDTHH:mm:ss". */
export function nowLocalIso(now = new Date()): string {
  return utcToLocal(now.getTime())
}

export function monthStartIso(day = todayIso()): string {
  return `${day.slice(0, 8)}01`
}

export function monthEndIso(day = todayIso()): string {
  const [y, m] = day.split("-").map(Number)
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`
}

/** Default period of the balance pages opened from the menu: 1st of the
 * current month .. today (demo `{fromDate: YYYY-MM-01, toDate: today}`). */
export function defaultBalancePeriod(now = new Date()): { from: string; to: string } {
  const to = todayIso(now)
  return { from: monthStartIso(to), to }
}

/** "DD.MM.YYYY" as the demo's filter header shows dates. */
export function formatDotDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}.${m}.${y}` : iso
}

const INTL_LOCALES: Record<string, string> = { ru: "ru-RU", en: "en-GB" }

// Browsers often lack ICU month names for uz-Latn / tk (they print "M10"),
// so those two languages use explicit tables.
const MONTHS: Record<string, { long: string[]; short: string[] }> = {
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

function dateFromIso(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  const [h, mi] = (iso.slice(11, 16) || "00:00").split(":").map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, h || 0, mi || 0))
}

/** Localised "8 октября" / "8 oktabr" (demo "Баланс на {D MMMM}"). */
export function formatDayMonth(iso: string, language = "ru"): string {
  const table = MONTHS[language]
  if (table) return `${Number(iso.slice(8, 10))} ${table.long[Number(iso.slice(5, 7)) - 1] ?? ""}`
  return new Intl.DateTimeFormat(INTL_LOCALES[language] ?? "ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(dateFromIso(iso))
}

/** Localised "08 окт. 2026" / "08 okt 2026" (with ", 18:42" when `withTime`) for statement rows. */
export function formatStatementDate(iso: string, language = "ru", withTime = true): string {
  const table = MONTHS[language]
  if (table) {
    const day = `${iso.slice(8, 10)} ${table.short[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`
    return withTime && iso.length >= 16 ? `${day}, ${iso.slice(11, 16)}` : day
  }
  const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }
  if (withTime) Object.assign(options, { hour: "2-digit", minute: "2-digit", hour12: false })
  // The reference prints "04 авг. 2026, 18:42" (no "г." that ICU adds for ru).
  return new Intl.DateTimeFormat(INTL_LOCALES[language] ?? "ru-RU", options).format(dateFromIso(iso)).replace(/ г\.(,|$)/, "$1")
}

const RU_MONTH_ABBR = ["Янв.", "Февр.", "Март", "Апр.", "Май", "Июнь", "Июль", "Авг.", "Сент.", "Окт.", "Нояб.", "Дек."]

/** "01 Окт. 2026 - 31 Окт. 2026": the current calendar month as the report builders label their default period. */
export function monthRangeLabel(day: string = todayIso()): string {
  const [year, month] = day.split("-").map(Number)
  const last = new Date(year, month, 0).getDate()
  const name = RU_MONTH_ABBR[month - 1]
  return `01 ${name} ${year} - ${String(last).padStart(2, "0")} ${name} ${year}`
}
