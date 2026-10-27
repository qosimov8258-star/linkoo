// Dates in the UI language, for client and server components alike.
//
// The shape is the one the catalog pages already use (warehouses, brands, units,
// price lists: lib/finance/dates.ts formatStatementDate): "20 окт. 2026" /
// "20 okt 2026" / "20 Oct 2026", with ", 11:17" when the time is shown. uz and tk
// month names come from explicit tables there, because browsers often lack them.
//
// Some APIs still send a ready Russian label ("20 окт. 2026 г.", "21 окт. 2026, 00:22");
// formatDateText parses it back (parseAnyDate) so it is shown in the UI language too.
import { formatStatementDate, parseAnyDate } from "@/lib/finance/dates"

import { translate } from "./translate"
import type { LanguageCode } from "./types"

const pad = (value: number) => String(value).padStart(2, "0")

const TIME = /\d{1,2}:\d{2}/

/** ru Intl writes "20 окт. 2026 г."; the app (reference "DD MMM YYYY") drops the "г.". */
function withoutYearMark(text: string): string {
  return text.replace(/\s*г\.(?=,|\s|$)/, "")
}

/** A moment (browser-local time) in the UI language: "20 okt 2026" (", 11:17" with `withTime`). */
export function formatDate(value: Date, language: LanguageCode, withTime = false): string {
  if (Number.isNaN(value.getTime())) return ""
  const iso = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
  return withoutYearMark(formatStatementDate(iso, language, withTime))
}

/**
 * Any stored date text in the UI language: an ISO day or timestamp, "20.10.2026", or a
 * Russian label from an API ("20 окт. 2026, 11:17"). The time is shown when the text has
 * one, unless `withTime` says otherwise. `utc`: a zone-less "YYYY-MM-DD HH:MM:SS"
 * (created_at columns) is UTC and is shown in the business time zone (Asia/Tashkent).
 * Text that is not a date goes through the dictionary instead of staying Russian.
 */
export function formatDateText(
  value: string | null | undefined,
  language: LanguageCode,
  options: { withTime?: boolean; utc?: boolean } = {},
): string {
  const text = String(value ?? "").trim()
  if (!text) return ""
  // A Russian label is already right for ru (e.g. "08 июня 2026", the reference app's month form).
  if (language === "ru" && /[А-Яа-яЁё]/.test(text) && options.withTime === undefined) return withoutYearMark(text)
  const iso = parseAnyDate(text, options.utc)
  if (!iso) return translate(language, text)
  const withTime = options.withTime ?? TIME.test(text)
  return withoutYearMark(formatStatementDate(iso, language, withTime))
}
