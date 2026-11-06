// Helpers of the finance importers (scripts/linko-sync/import-finance-*.mjs): the date / name / rate forms the local
// cash core and finance ledger write, so imported Linko rows look exactly like rows the app created itself.
import { fullName, register } from "./lib.mjs"

const GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

function parts(value) {
  if (!value) return null
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4] ?? 0), mi: Number(m[5] ?? 0), s: Number(m[6] ?? 0) }
}
const pad = (n) => String(n).padStart(2, "0")

/** Linko sends Tashkent wall-clock time: "2026-11-02T22:12:07.123" → local ISO "2026-11-02T22:12:07" (the business
 * date form of entry_date / payment_date / date columns). */
export function localIso(value) {
  const p = parts(value)
  return p ? `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}` : ""
}

/** Tashkent wall-clock → "YYYY-MM-DD HH:MM:SS" UTC (the created_at / updated_at text columns, datetime('now') form). */
export function utcText(value) {
  const p = parts(value)
  if (!p) return null
  const d = new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - 5 * 3600_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** "09 октября 2026, 14:05" — lib/finance/customer-payment.ts russianDateTime (paid_at / accepted_at of payments). */
export function russianDateTime(value) {
  const p = parts(value)
  return p ? `${pad(p.d)} ${GENITIVE[p.mo - 1]} ${p.y}, ${pad(p.h)}:${pad(p.mi)}` : ""
}

/** Linko rate_type "0" | "1" | "2" → the cash core's "current" | "order" | "custom". */
export function rateType(value) {
  const v = String(value ?? "")
  return v === "2" ? "custom" : v === "1" ? "order" : "current"
}

export const name = (user) => fullName(user)
export const num = (value) => (value === null || value === undefined || value === "" ? null : Number(value))
export const money = (value) => Number(value ?? 0)
export const text = (value) => (value === null || value === undefined ? "" : String(value).trim())

/** Deletes rows of `table` whose id is not in `keep` (Set of numbers); each removed row is kept in linko_sync_rows. */
export async function deleteOthers(client, run, table, keep, idColumn = "id") {
  const rows = (await client.query(`SELECT * FROM ${table}`)).rows
  let removed = 0
  for (const row of rows) {
    if (keep.has(Number(row[idColumn]))) continue
    await client.query(`DELETE FROM ${table} WHERE ${idColumn} = $1`, [row[idColumn]])
    await register(client, run, table, row[idColumn], "delete", row)
    removed++
  }
  return removed
}

/** Inserts (or replaces) a row by id with exactly `values`; returns "insert" | "update" | "same". */
export async function putRow(client, run, table, id, values) {
  const cols = Object.keys(values)
  const current = (await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0]
  if (!current) {
    const all = ["id", ...cols]
    await client.query(`INSERT INTO ${table} (${all.map((c) => `"${c}"`).join(", ")}) VALUES (${all.map((_, i) => `$${i + 1}`).join(", ")})`, [
      id,
      ...cols.map((c) => values[c]),
    ])
    await register(client, run, table, id, "insert")
    return "insert"
  }
  const changed = cols.filter((c) => !same(current[c], values[c]))
  if (!changed.length) return "same"
  await client.query(`UPDATE ${table} SET ${changed.map((c, i) => `"${c}" = $${i + 2}`).join(", ")} WHERE id = $1`, [id, ...changed.map((c) => values[c])])
  await register(client, run, table, id, "update", Object.fromEntries(changed.map((c) => [c, current[c]])))
  return "update"
}

function same(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-9
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b)
  return String(a) === String(b)
}

/** Moves the id sequence of `table` past its highest id. */
export async function bumpIdSequence(client, table) {
  await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`)
}

/** Moves cash_doc_seq (the "№" of every cash document) past every stored doc_no. */
export async function bumpCashDocSequence(client) {
  const tables = ["cash_management_entries", "customer_payments", "supplier_payments", "cash_transfers", "cash_acceptances"]
  const parts = []
  for (const table of tables) {
    const has = (await client.query("SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'doc_no'", [table])).rowCount
    if (has) parts.push(`SELECT COALESCE(MAX(doc_no), 0) AS n FROM ${table}`)
  }
  const max = Number((await client.query(`SELECT MAX(n) AS n FROM (${parts.join(" UNION ALL ")}) x`)).rows[0].n ?? 0)
  await client.query("SELECT setval('cash_doc_seq', GREATEST($1::bigint, 1))", [max])
  return max
}

/** A summary line per table: counts of insert / update / same / delete. */
export function counter() {
  const stats = {}
  return {
    add(table, action) {
      stats[table] ??= { insert: 0, update: 0, same: 0, delete: 0 }
      stats[table][action] = (stats[table][action] ?? 0) + 1
    },
    del(table, n) {
      stats[table] ??= { insert: 0, update: 0, same: 0, delete: 0 }
      stats[table].delete += n
    },
    print(title) {
      console.log(title)
      for (const [table, s] of Object.entries(stats)) console.log(`  ${table.padEnd(32)} insert ${s.insert}, update ${s.update}, unchanged ${s.same}, removed ${s.delete}`)
    },
  }
}
