import type { RefinementCtx } from "zod"

import { parseAnyDate, todayIso } from "@/lib/finance/dates"

// Date rules of business documents — the one place every writer checks a typed date:
// - every document date has a year in DOC_MIN_YEAR..DOC_MAX_YEAR ("0001-01-01" or
//   "9999-12-31" are typos, and a year below 1000 would be stored malformed as "1-01-01T00");
// - money and supply documents (cash entries, customer / supplier payments, supplier
//   incomings / returns, balance correction entries), and stock / cost documents dated by
//   what already happened (transfers, write-offs, inventories, equipment, manual costs),
//   are never dated after today (Asia/Tashkent), so a typo never hides an amount until
//   that day comes;
// - plans, contract validity and expected-payment dates may be in the future (allowFuture).
// An edit may keep the day the document already has (`current`), so an older future-dated
// row stays editable. Messages are Russian i18n keys.

export const DOC_MIN_YEAR = 2000
export const DOC_MAX_YEAR = 2100
export const DOC_DATE_INVALID = "Неверная дата"
export const DOC_DATE_FUTURE = "Дата не может быть позже сегодняшнего дня"

export type DocDateRule = {
  /** The date may be later than today (plans, contract validity, expected payments). */
  allowFuture?: boolean
  /** The date the edited document already has: keeping that day is never refused as
   * "future", so an existing future-dated row stays editable. */
  current?: unknown
}

/** A local date text "YYYY-MM-DD…" whose 4-digit year is within DOC_MIN_YEAR..DOC_MAX_YEAR. */
export function docYearOk(local: string | null | undefined): boolean {
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(String(local ?? "").trim())
  if (!match) return false
  const year = Number(match[1])
  return year >= DOC_MIN_YEAR && year <= DOC_MAX_YEAR
}

/** parseAnyDate (lib/finance/dates.ts) of a date someone typed or sent: the same formats → local
 * "YYYY-MM-DDTHH:mm:ss", or null. An offset no time zone has (minutes above 59, beyond ±14:00,
 * e.g. "+99:99") is unparseable, instead of silently moving the date by days. Writers parse
 * every input date with it; stored values are read with parseAnyDate. */
export function parseDocInput(value: string | null | undefined): string | null {
  // parseAnyDate itself refuses impossible offsets (lib/finance/dates.ts).
  return parseAnyDate(value)
}

/** Error key of an already parsed local date ("YYYY-MM-DD[THH:mm[:ss]]"; null = unparseable), or null when it is fine. */
export function docDateError(local: string | null | undefined, rule: DocDateRule = {}): string | null {
  if (!local || !docYearOk(local)) return DOC_DATE_INVALID
  const day = local.slice(0, 10)
  if (!rule.allowFuture && day > todayIso()) {
    const kept = typeof rule.current === "string" && rule.current ? parseAnyDate(rule.current)?.slice(0, 10) : null
    if (kept !== day) return DOC_DATE_FUTURE
  }
  return null
}

/** A checked document date: the canonical local value, or the error key. */
export type DocDate = { ok: true; date: string } | { ok: false; error: string }

/** Any accepted input date (ISO day / date-time, "19.10.2026", "19 октября 2026 г.", see
 * parseDocInput) under the document rules → canonical local "YYYY-MM-DDTHH:mm:ss", or the
 * error key. The caller handles an empty value (its own default). */
export function parseDocDate(value: string | null | undefined, rule: DocDateRule = {}): DocDate {
  const local = parseDocInput(value)
  const error = docDateError(local, rule)
  return error || !local ? { ok: false, error: error ?? DOC_DATE_INVALID } : { ok: true, date: local }
}

/** As parseDocDate, for a document stored by its day: canonical "YYYY-MM-DD", or the error key. */
export function parseDocDay(value: string | null | undefined, rule: DocDateRule = {}): DocDate {
  const parsed = parseDocDate(value, rule)
  return parsed.ok ? { ok: true, date: parsed.date.slice(0, 10) } : parsed
}

/** zod `.superRefine` check of an optional date text field: an empty value passes
 * (the writer defaults it), anything else must pass parseDocDate. */
export function docDateCheck(rule: DocDateRule = {}) {
  return (value: string | null | undefined, ctx: RefinementCtx) => {
    if (value === undefined || value === null || !value.trim()) return
    const result = parseDocDate(value, rule)
    if (!result.ok) ctx.addIssue({ code: "custom", message: result.error })
  }
}

/** A 400 answer of parseJsonBody (lib/validation.ts) that failed only on the date field
 * (docDateCheck: "Неверная дата" / "Дата не может быть позже сегодняшнего дня"): its `error`
 * becomes that reason (with `field`), instead of the generic "Неверные данные", so a dialog that
 * shows the answer's error at the date field says why. Any other answer passes unchanged. */
export async function dateReasonFirst(response: Response, field = "date"): Promise<Response> {
  type Body = { error?: string; details?: { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> } }
  const body = (await response.clone().json().catch(() => null)) as Body | null
  const fieldErrors = body?.details?.fieldErrors ?? {}
  const reason = fieldErrors[field]?.find((message) => message === DOC_DATE_INVALID || message === DOC_DATE_FUTURE)
  const others = Object.entries(fieldErrors).some(([name, messages]) => name !== field && messages?.length) || Boolean(body?.details?.formErrors?.length)
  if (response.status !== 400 || !reason || others) return response
  return Response.json({ ...body, error: reason, field }, { status: 400 })
}
