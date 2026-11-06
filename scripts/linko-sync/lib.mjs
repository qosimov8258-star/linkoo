// Shared helpers of the Linko → Mezon data sync (scripts/linko-sync). The scripts read the raw JSON that fetch.mjs
// downloaded from a Linko account (read-only GETs) and write it into the LOCAL database of this app. Nothing here ever
// writes to Linko. The raw files hold business data: they live under backups/ (git-ignored) and never in the repo.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, "../..")

/** Folder with the downloaded raw files: RAW env, else the newest backups/linko-raw/<date>. */
export function rawDir() {
  if (process.env.RAW) return process.env.RAW
  const base = path.join(ROOT, "backups", "linko-raw")
  const days = fs.existsSync(base) ? fs.readdirSync(base).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort() : []
  if (!days.length) throw new Error("No raw data: run scripts/linko-sync/fetch.mjs first")
  return path.join(base, days[days.length - 1])
}

/** The `data` of a raw file (a list, an object, or {id: detail} for detail files). */
export function raw(name) {
  const file = path.join(rawDir(), `${name}.json`)
  if (!fs.existsSync(file)) throw new Error(`Raw file missing: ${file}`)
  return JSON.parse(fs.readFileSync(file, "utf8")).data
}

export function hasRaw(name) {
  return fs.existsSync(path.join(rawDir(), `${name}.json`))
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = path.join(ROOT, ".env")
  const match = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.*)$/m) : null
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

/** A client of the local database (TARGET_DB=<name> picks another database of the same server). Refuses remote hosts
 * unless ALLOW_REMOTE=1, so a sync is never pointed at production by accident. */
export async function connect() {
  const url = new URL(databaseUrl())
  if (process.env.TARGET_DB) url.pathname = "/" + process.env.TARGET_DB
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) && process.env.ALLOW_REMOTE !== "1") {
    throw new Error(`Refusing to write to ${url.hostname}: set ALLOW_REMOTE=1 to sync a non-local database`)
  }
  const client = new pg.Client({ connectionString: url.toString() })
  await client.connect()
  return client
}

/** Registry of what the sync wrote (table, row id, action, previous row for updates), so a run can be audited. */
export async function ensureRegistry(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS linko_sync_rows (
    seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    action TEXT NOT NULL,
    previous JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  await client.query("CREATE INDEX IF NOT EXISTS linko_sync_rows_table_idx ON linko_sync_rows (table_name, row_id)")
}

export async function register(client, run, table, rowId, action, previous = null) {
  await client.query("INSERT INTO linko_sync_rows (run, table_name, row_id, action, previous) VALUES ($1, $2, $3, $4, $5)", [
    run,
    table,
    String(rowId),
    action,
    previous == null ? null : JSON.stringify(previous),
  ])
}

export const runId = (name) => `${name}:${new Date().toISOString().slice(0, 19)}`

// --- formatting as the reference prints it (and as the earlier imported rows store it) ------------------------------

const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const LONG_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

/** Reference timestamps are Tashkent wall-clock time without a zone: keep the digits as they are. */
function parts(value) {
  if (!value) return null
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  return { y: m[1], mo: Number(m[2]), d: m[3], h: m[4] ?? "00", mi: m[5] ?? "00", s: m[6] ?? "00" }
}

/** "21 апр. 2026" */
export function ruShortDate(value) {
  const p = parts(value)
  return p ? `${p.d} ${SHORT_MONTHS[p.mo - 1]} ${p.y}` : ""
}

/** "21 апр. 2026, 14:05" */
export function ruShortDateTime(value) {
  const p = parts(value)
  return p ? `${p.d} ${SHORT_MONTHS[p.mo - 1]} ${p.y}, ${p.h}:${p.mi}` : ""
}

/** "23 сентября 2024, 14:12" */
export function ruLongDateTime(value) {
  const p = parts(value)
  return p ? `${Number(p.d)} ${LONG_MONTHS[p.mo - 1]} ${p.y}, ${p.h}:${p.mi}` : ""
}

/** "2026-04-21 14:05:00" (the local tables' text timestamps) */
export function sqlDateTime(value) {
  const p = parts(value)
  return p ? `${p.y}-${String(p.mo).padStart(2, "0")}-${p.d} ${p.h}:${p.mi}:${p.s}` : null
}

/** Tashkent wall-clock time (as Linko sends it) → ISO UTC with "Z" ("2026-09-08T15:03:32.414Z"), the form the app
 * writes for acceptance moments (fin_ts reads a trailing Z as UTC and shows the local day). */
export function utcIso(value) {
  const p = parts(value)
  if (!p) return null
  const ms = String(value).match(/\.(\d{1,3})/)
  const local = Date.UTC(Number(p.y), p.mo - 1, Number(p.d), Number(p.h), Number(p.mi), Number(p.s), ms ? Number(ms[1].padEnd(3, "0")) : 0)
  return new Date(local - 5 * 3600_000).toISOString()
}

/** "2026-04-21" */
export function isoDay(value) {
  const p = parts(value)
  return p ? `${p.y}-${String(p.mo).padStart(2, "0")}-${p.d}` : ""
}

export const num = (value) => (value == null || value === "" ? null : Number(value))

/** Tashkent "today" as YYYY-MM-DD. */
export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date())
}

export function fullName(user) {
  if (!user) return ""
  return [user.first_name, user.second_name].filter(Boolean).join(" ").trim()
}

/** Linko currency → the local currency code (currencies.code: SUM / USD / EUR). */
export function currencyCode(currency) {
  if (!currency) return "SUM"
  const id = typeof currency === "object" ? currency.id : null
  const name = String(typeof currency === "object" ? currency.name ?? "" : currency).trim().toUpperCase()
  if (id === 1 || name === "SUM" || name === "SOM" || name === "UZS") return "SUM"
  if (id === 2 || name === "USD") return "USD"
  if (id === 3 || name === "EURO" || name === "EUR" || name === "ЕВРО") return "EUR"
  return name || "SUM"
}

/** Inserts or updates one row by id, registering the action (and the previous row for updates). Compares the given
 * columns only, so an unchanged row is left alone. Returns "insert" | "update" | "same". */
export async function upsertById(client, run, table, id, values) {
  const cols = Object.keys(values)
  const current = (await client.query(`SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM ${table} WHERE id = $1`, [id])).rows[0]
  if (!current) {
    const all = ["id", ...cols]
    await client.query(
      `INSERT INTO ${table} (${all.map((c) => `"${c}"`).join(", ")}) VALUES (${all.map((_, i) => `$${i + 1}`).join(", ")})`,
      [id, ...cols.map((c) => values[c])],
    )
    await register(client, run, table, id, "insert")
    return "insert"
  }
  const changed = cols.filter((c) => !sameValue(current[c], values[c]))
  if (!changed.length) return "same"
  await client.query(
    `UPDATE ${table} SET ${changed.map((c, i) => `"${c}" = $${i + 2}`).join(", ")} WHERE id = $1`,
    [id, ...changed.map((c) => values[c])],
  )
  await register(client, run, table, id, "update", Object.fromEntries(changed.map((c) => [c, current[c]])))
  return "update"
}

function sameValue(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-9
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b)
  return String(a) === String(b)
}

/** Moves a table's id sequence past the highest id (after inserts with explicit ids). */
export async function bumpSequence(client, table) {
  await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`)
}
