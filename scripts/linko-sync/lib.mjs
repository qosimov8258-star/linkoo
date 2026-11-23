// Shared helpers of the Linko → Mezon data sync (scripts/linko-sync). The scripts read the raw JSON that fetch.mjs
// downloaded from a Linko account (read-only GETs) and write it into the LOCAL database of this app. Nothing here ever
// writes to Linko. The raw files hold business data: they live under backups/ (git-ignored) and never in the repo.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, "../..")

const BACKUPS = path.join(ROOT, "backups")

/** The first account's folders (backups/linko-raw/<date>): read only while RAW is not set. */
const LEGACY_BASE = path.join(BACKUPS, "linko-raw")

/** The Linko server of the first account: its downloads are backups/linko-raw/<date>, its copy is the database of
 * DATABASE_URL. Every other account is downloaded into backups/linko-raw-<server>/<date> and copied into a database of
 * its own (TARGET_DB). */
export const FIRST_SERVER = "time3"

const SERVER_NAME = /^[a-z0-9][a-z0-9-]*$/

/**
 * The Linko server whose download `dir` is: the server its source.json names (fetch.mjs writes {"server": …} into every
 * folder it downloads into), else what its place says (below backups/linko-raw: the first account; below
 * backups/linko-raw-<server>: that server); null when neither tells. Throws when the two disagree.
 */
export function folderServer(dir) {
  const file = path.join(dir, "source.json")
  const named = fs.existsSync(file) ? String(JSON.parse(fs.readFileSync(file, "utf8")).server ?? "").trim().toLowerCase() || null : null
  const placed = placeServer(dir)
  if (named && placed && named !== placed) throw new Error(`${dir}: its source.json names the Linko server "${named}", but the folder is below backups/linko-raw…`)
  return named ?? placed
}

/** The Linko server a path below backups/linko-raw (the first account) or backups/linko-raw-<server> belongs to; null
 * for any other place. */
function placeServer(p) {
  const top = path.relative(BACKUPS, path.resolve(p)).split(path.sep)[0]
  return top === "linko-raw" ? FIRST_SERVER : top.startsWith("linko-raw-") ? top.slice("linko-raw-".length).toLowerCase() : null
}

/** The Linko server of the files a run reads: RAW's (folderServer; an unknown one stops the step), else the first
 * account's. */
export function filesServer() {
  const dir = rawEnv()
  if (!dir) return FIRST_SERVER
  const server = folderServer(dir)
  if (!server) {
    throw new Error(
      `Cannot tell which Linko account RAW holds (${dir}): it has no source.json and is not below backups/linko-raw or backups/linko-raw-<server>. ` +
        `Write {"server": "<its Linko server>"} into ${path.join(dir, "source.json")}`,
    )
  }
  return server
}

/**
 * Where fetch.mjs / fetch-shop-drawer.mjs download to, from which Linko server: { server, dir }. With RAW, LINKO_SERVER
 * must be set too and must be the server RAW already belongs to (folderServer), so one account's files never go into
 * another account's folder. Without RAW: backups/linko-raw/<day> for the first account (LINKO_SERVER unset or
 * FIRST_SERVER), backups/linko-raw-<server>/<day> for any other. Creates nothing.
 */
export function fetchTarget(day) {
  const server = String(process.env.LINKO_SERVER ?? "").trim().toLowerCase()
  if (server && !SERVER_NAME.test(server)) throw new Error(`LINKO_SERVER is not a Linko server name: ${server}`)
  if (process.env.RAW !== undefined) {
    if (!process.env.RAW.trim()) throw new Error("RAW is set but empty: name the download folder, or unset RAW")
    if (!server) throw new Error("RAW is set: set LINKO_SERVER as well (the Linko server whose download RAW is)")
    const dir = path.resolve(process.env.RAW)
    const known = folderServer(dir)
    if (known && known !== server) throw new Error(`RAW (${dir}) holds the download of the Linko server "${known}", not of "${server}"`)
    return { server, dir }
  }
  const name = server || FIRST_SERVER
  return { server: name, dir: path.join(BACKUPS, name === FIRST_SERVER ? "linko-raw" : `linko-raw-${name}`, day) }
}

/** Creates the download folder and, the first time, its source.json ({"server": …}): what folderServer() reads. */
export function markFolder(dir, server) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "source.json")
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify({ server, marked: new Date().toISOString() }, null, 2)}\n`)
}

/** RAW as an absolute folder (a relative RAW is taken from the current directory), or null when RAW is not set. A RAW
 * that is not a folder stops the step, so a mistyped RAW never reads as "nothing there" or as another folder. */
export function rawEnv() {
  const value = process.env.RAW
  if (value === undefined) return null
  if (!value.trim()) throw new Error("RAW is set but empty: name the download folder, or unset RAW for the first account")
  const dir = path.resolve(value)
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`RAW is not a folder: ${dir}`)
  return dir
}

/** Folder with the downloaded raw files: RAW env, else the newest backups/linko-raw/<date> of a full download (its lists
 * step wrote orders.json; a folder of a few screens' captures or of single steps is skipped). */
export function rawDir() {
  const env = rawEnv()
  if (env) return env
  const days = legacyDays().filter((name) => fs.existsSync(path.join(LEGACY_BASE, name, "orders.json")))
  if (!days.length) throw new Error("No raw data: run scripts/linko-sync/fetch.mjs first")
  return path.join(LEGACY_BASE, days[0])
}

/** The backups/linko-raw/<date> folder names, newest first. */
function legacyDays() {
  return fs.existsSync(LEGACY_BASE) ? fs.readdirSync(LEGACY_BASE).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse() : []
}

/**
 * Where a step finds an input that is not always part of the full download: a read-only capture of Linko's screens or
 * the file of a single fetch step (`relPath`, a file or a folder: "permission-tags", "knowledge-base/knowledge.json",
 * "salary_cards.json"). Returns the absolute path, or null when it is not there.
 *  - `env`: the name of an explicit override (TAGS_DIR=<folder> …), which wins over everything else; one inside another
 *    account's download folder (backups/linko-raw… of another server) stops the step.
 *  - RAW set: ONLY <RAW>/<relPath>. Never backups/linko-raw: the download of another Linko account must not pick up
 *    the first account's captures.
 *  - RAW not set (the first account, as before): `legacy` "newest" (default) = the newest backups/linko-raw/<date>
 *    that holds relPath; a path below backups/linko-raw ("2026-11-20/permission-tags") = that fixed place, returned
 *    even when it is missing (the step reports it as it always did).
 */
export function captured(relPath, { env, legacy = "newest" } = {}) {
  if (env && process.env[env]) return override(env)
  const dir = rawEnv()
  if (dir) {
    const file = path.join(dir, relPath)
    return fs.existsSync(file) ? file : null
  }
  if (legacy !== "newest") return path.join(LEGACY_BASE, legacy)
  const day = legacyDays().find((name) => fs.existsSync(path.join(LEGACY_BASE, name, relPath)))
  return day ? path.join(LEGACY_BASE, day, relPath) : null
}

/** The value of an explicit file / folder override (TAGS_DIR, CARDS, PROVIDERS_DETAIL …), or undefined. One inside another
 * account's download folder (below backups/linko-raw… of another server than the files of this run) stops the step:
 * it would bring that account's capture into this run. `base`: the folder a relative value is taken from. */
export function override(name, { base = process.cwd() } = {}) {
  const value = process.env[name]
  if (!value) return undefined
  const owner = placeServer(path.resolve(base, value))
  if (owner && owner !== filesServer()) throw new Error(`${name}=${value} is the Linko account "${owner}"'s capture, this run reads "${filesServer()}"`)
  return value
}

/** Ends the step before it writes anything (exit 0) when RAW is set and lacks the input: "skipped: <relPath> not in RAW". */
export function skipUnlessInRaw(file, relPath) {
  if (file == null && rawEnv()) {
    console.log(`skipped: ${relPath} not in RAW`)
    process.exit(0)
  }
  return file
}

/** captured(), ending the step without writing when RAW is set and does not hold relPath. */
export function capturedOrSkip(relPath, options) {
  return skipUnlessInRaw(captured(relPath, options), relPath)
}

/** The product cards capture ({id: card}, import-product-cards / import-raw-cards): product-detail/products_detail.json
 * as captured() finds it; with RAW also <RAW>/products_detail.json, for RAW=<that capture folder> itself. Ends the step
 * without writing when RAW holds neither. */
export function productCardsFile() {
  const file = captured("product-detail/products_detail.json") ?? (rawEnv() ? captured("products_detail.json") : null)
  return skipUnlessInRaw(file, "product-detail/products_detail.json")
}

/** The folders whose captures a step may read (to walk them): RAW alone when it is set, else every backups/linko-raw/<date>
 * (oldest first), each with its date ("" for RAW). */
export function captureRoots() {
  const dir = rawEnv()
  if (dir) return [{ dir, day: "" }]
  return legacyDays()
    .reverse()
    .map((day) => ({ dir: path.join(LEGACY_BASE, day), day }))
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

let homeUrl = null

/** DATABASE_URL (env, else .env) as the step started: the first account's database. Read once, so a step that points
 * DATABASE_URL at the target for the app's code (appDatabase) still knows it. */
function databaseUrl() {
  if (homeUrl) return homeUrl
  if (process.env.DATABASE_URL) return (homeUrl = process.env.DATABASE_URL)
  const envFile = path.join(ROOT, ".env")
  const match = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.*)$/m) : null
  if (!match) throw new Error("DATABASE_URL is not set")
  return (homeUrl = match[1].trim())
}

/** The database the importers write to: DATABASE_URL with TARGET_DB=<name> as its database (another database of the
 * same server). Refuses remote hosts unless ALLOW_REMOTE=1, so a sync is never pointed at production by accident. */
export function targetUrl() {
  const url = new URL(databaseUrl())
  if (process.env.TARGET_DB !== undefined) {
    if (!process.env.TARGET_DB.trim()) throw new Error("TARGET_DB is set but empty: name the database, or unset TARGET_DB")
    url.pathname = "/" + process.env.TARGET_DB
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) && process.env.ALLOW_REMOTE !== "1") {
    throw new Error(`Refusing to write to ${url.hostname}: set ALLOW_REMOTE=1 to sync a non-local database`)
  }
  return url
}

/** A client of the target database (targetUrl), after checkAccount() let this run write there. */
export async function connect() {
  const client = new pg.Client({ connectionString: targetUrl().toString() })
  await client.connect()
  try {
    await checkAccount(client)
  } catch (error) {
    await client.end().catch(() => {})
    throw error
  }
  return client
}

/** For the steps that run the app's own code (tsx): checks the account as connect() does, then points DATABASE_URL,
 * which the app's pool reads, at the target database. Returns the database's name. */
export async function appDatabase() {
  const client = await connect()
  const name = (await client.query("SELECT current_database() AS name")).rows[0].name
  await client.end()
  process.env.DATABASE_URL = targetUrl().toString()
  return name
}

/** The Linko server a database holds (its linko_sync_source mark), or null before its first import. */
async function databaseServer(client) {
  if (!(await tableExists(client, "linko_sync_source"))) return null
  return (await client.query("SELECT server FROM linko_sync_source WHERE id = 1")).rows[0]?.server ?? null
}

/**
 * One database holds one Linko account. The first import into a database marks it with the account of its files
 * (linko_sync_source); later runs must bring files of that account, and a mark is never overridden. A database without
 * the mark takes the first account's files only when it is DATABASE_URL's own database, and another account's only when
 * TARGET_DB names a different one (ALLOW_MIX=1 lets such a run mark it anyway). DRY=1 checks without marking.
 */
async function checkAccount(client) {
  const files = filesServer()
  const source = rawEnv() ? path.relative(ROOT, rawEnv()) || rawEnv() : "backups/linko-raw/<date>"
  const db = (await client.query("SELECT current_database() AS name")).rows[0].name
  const marked = await databaseServer(client)
  if (marked) {
    if (marked !== files) throw new Error(`Refusing: the database ${db} holds the Linko account "${marked}", the files (${source}) are of "${files}"`)
    return
  }
  const home = db === decodeURIComponent(new URL(databaseUrl()).pathname.slice(1))
  if ((files === FIRST_SERVER) !== home && process.env.ALLOW_MIX !== "1") {
    throw new Error(
      files === FIRST_SERVER
        ? `Refusing: without RAW the files are the first account's (${FIRST_SERVER}, ${source}), but ${db} is not DATABASE_URL's database. ` +
            `Set RAW to the download of ${db}'s own account (ALLOW_MIX=1 if ${db} is meant to be a copy of ${FIRST_SERVER})`
        : `Refusing: RAW (${source}) holds the Linko account "${files}", but ${db} is DATABASE_URL's database (the first account's copy). ` +
            `Set TARGET_DB to the database of "${files}" (ALLOW_MIX=1 to write into ${db} anyway)`,
    )
  }
  if (process.env.DRY === "1") return
  await client.query(`CREATE TABLE IF NOT EXISTS linko_sync_source (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    server TEXT NOT NULL,
    raw TEXT NOT NULL DEFAULT '',
    marked_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  await client.query("INSERT INTO linko_sync_source (id, server, raw) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING", [files, source])
  const now = await databaseServer(client)
  if (now !== files) throw new Error(`Refusing: the database ${db} holds the Linko account "${now}", the files (${source}) are of "${files}"`)
  console.log(`database ${db}: marked as the copy of the Linko account "${files}"`)
}

/** Whether a table (or view) exists in the database. */
export async function tableExists(client, name) {
  return Boolean((await client.query("SELECT to_regclass($1) IS NOT NULL AS ok", [name])).rows[0].ok)
}

/** Whether a column exists in a table of the current schema. */
export async function columnExists(client, table, column) {
  const sql = "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2"
  return (await client.query(sql, [table, column])).rowCount > 0
}

/** Whether `table` can hold rows a demo seed wrote: the seeds (scripts/demo) register their rows in demo_seed_rows, so
 * a database they never ran on (a new account's copy) has nothing to remove. */
export async function demoSeeded(client, table) {
  return (await tableExists(client, "demo_seed_rows")) && (await tableExists(client, table))
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
