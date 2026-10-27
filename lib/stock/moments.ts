// Moments of stock movements with millisecond precision. The order of the
// documents of one day (the moving-average cost ledger) depends on them, and
// several documents are often registered within the same second, so the
// stock documents store their moments with milliseconds and the ledger reads
// them without dropping the fraction (fin_ts() / parseAnyDate() keep seconds).

/** Asia/Tashkent has no DST: UTC+5 all year (as lib/finance/dates.ts). */
const TZ_OFFSET_MS = 5 * 60 * 60 * 1000

const pad = (value: number, size = 2) => String(value).padStart(size, "0")

function format(utcMs: number): string {
  const local = new Date(utcMs + TZ_OFFSET_MS)
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}.${pad(local.getUTCMilliseconds(), 3)}`
}

/** Current local (Asia/Tashkent) moment "YYYY-MM-DDTHH:mm:ss.mmm". */
export function nowLocalMoment(now = new Date()): string {
  return format(now.getTime())
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i

/** Local "YYYY-MM-DDTHH:mm:ss.mmm" of an ISO-like stored moment (keeping milliseconds), or
 * null when the text has another shape. `utc` = a zone-less value is UTC (created_at). */
export function preciseLocalMoment(value: string | null | undefined, utc = false): string | null {
  const match = ISO.exec(String(value ?? "").trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s, fraction, zone] = match
  const ms = Number((fraction ?? "").slice(0, 3).padEnd(3, "0"))
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0), ms)
  if (!Number.isFinite(wall)) return null
  if (!zone && !utc) return format(wall - TZ_OFFSET_MS)
  let offsetMinutes = 0
  if (zone && zone.toUpperCase() !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1
    const digits = zone.slice(1).replace(":", "")
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0))
  }
  return format(wall - offsetMinutes * 60_000)
}
