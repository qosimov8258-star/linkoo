// Base rows of a Linko account, part "org-people": the records the other steps attach their rows to. The first copy
// (time3) got them from one-off imports long ago; on a new account's database nothing else creates them, so this step
// runs before the other importers. Every row keeps Linko's id (the later steps and the documents find it by that id)
// and the form the first copy stores:
//
// - currencies (finance/currencies): by id; code SUM / USD / EUR (lib.mjs currencyCode), the current rate and its day,
//   the base one (config PRIMARY_CURRENCY_ID, else SUM). A new row gets the app's display name (SUM → SOM, Euro →
//   ЕВРО), a stored name is kept (Валюты may rename it). The rate history is import-finance-contracts.mjs's.
// - organizations ← divisions (main/division): name, «Ограничение по долгу» (use_limit_for_debt), creation time.
// - branches (main/branch): name, the default price list's name, the currency code, debt tracking (show_balance),
//   «Основной филиал», the map point. in_balance is import-finance-ledgers.mjs's.
// - warehouses ← stocks (stock/stock): name, full name, address, the branch's and the manager's names (manager_id once
//   the employee is here), type, van sell (online), «Для возврата», minimum stock tracking, active, comment, point.
// - job_positions ← jobs (main/jobs) and access_rights ← positions (main/position; capability_ids = its groups in
//   Linko's order). capabilities ← groups (main/group/gcrud): Linko's groups are the Возможности of Права доступа.
//   Its built-in groups are named by a key (agent, delivery, …) that its screens translate: they get the names the app
//   finds them by (lib/default-roles.ts, the employee form, «Долги доставщиков»: Агент, Доставщик, …). Which
//   permissions a group grants is not in the download (the groups list holds id and name only): a new capability
//   starts with none, a stored list is kept.
//   The default rows the app writes into a new company's database (lib/job-positions-repo.ts DEFAULT_POSITIONS,
//   lib/default-roles.ts) are not Linko's: one Linko does not have (by id) is removed while nothing refers to it.
// - start_locations ← main/user/crud/start_locations: id, name, point (no app module creates the table: the first
//   copy's form of it).
// - employees (the main/crud lists, all / active / inactive, and each card main/crud/{id}/ = raw employees_detail):
//   names, login, phone, «Код для интеграции» (service_id), access right and job (when they are here), the
//   "access · job" position, branches and organizations (ids, and the names other pages read), «Доступ к системе»
//   (is_active → active), «Заблокирован» (is_blocked → system_access 0), «Показывать в отслеживании» (track_the_plan),
//   SMS check, one active device, GPS check, start point, and in details the supervisor, delivery man, audited agents,
//   warehouses, price lists, currencies, cashboxes, location points, shift, POS / superuser flags and the order
//   accesses (other keys of a stored details stay). Only employees: no sign-in account (users) is created.
// - employee_subscriptions ← main/crud/subscriptions (an employee's license) and billing_packages ← main/billing (the
//   purchased packages, in Linko's order): Linko's whole lists. Its balance and price list for Подписки are not in the
//   download (billing_account / billing_prices / billing_ledger stay as they are).
// Транспорт and Смены are import-settings-lists.mjs's (their tables are only made to exist here).
//
// First ensure-org-people-schema.ts creates, with the app's own code, the tables the app creates lazily. Then one
// transaction; every change is registered in linko_sync_rows (an update with the previous values, a removal with the
// row). Rows Linko does not have are left alone, except the app's defaults above and the subscription lists.
// DRY=1 runs everything and rolls the writes back (the schema step still runs).
//
//   node scripts/linko-sync/import-base-org-people.mjs     (RAW / TARGET_DB as for every importer)
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  bumpSequence,
  columnExists,
  connect,
  currencyCode,
  ensureRegistry,
  fullName,
  hasRaw,
  raw,
  register,
  ROOT,
  ruShortDate,
  runId,
  sqlDateTime,
  tableExists,
} from "./lib.mjs"
import { counter, utcText } from "./finance-lib.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const DRY = process.env.DRY === "1"

/** The names Linko's screens give its built-in groups (the app looks the capabilities up by them). */
const GROUP_NAMES = {
  agent: "Агент",
  delivery: "Доставщик",
  supervisor: "Супервайзер",
  collector: "Инкассатор",
  merch: "Мерчендайзер",
  cashier: "Кассир",
  manager: "Завсклад",
}
/** The app's display names of a new currency (scripts/apply-currency-category-names.mjs); the code stays. */
const CURRENCY_NAMES = { SUM: "SOM", EUR: "ЕВРО" }

/** What the app writes into a new company's database, keyed by the app_settings mark of each seed. */
const DEFAULTS = {
  job_positions: {
    mark: "seed:default_job_positions",
    names: ["Менеджер", "Агент", "Доставщик", "Инкассатор", "Оператор", "Супервайзер", "Мерчендайзер", "Админ", "Кассир", "Бухгалтер", "Зав. склад"],
  },
  access_rights: {
    mark: "seed:default_access_rights",
    names: ["Агент", "Доставщик", "Супервайзер", "Инкассатор", "Мерчендайзер", "Кассир", "Зав. склад", "Супер-Админ"],
  },
  capabilities: {
    mark: "seed:default_access_rights",
    names: [
      "Агент",
      "Агент | Функции",
      "Доставщик",
      "Доставщик | Функции",
      "Супервайзер",
      "Супервайзер | Функции",
      "Инкассатор",
      "Инкассатор | Функции",
      "Мерчендайзер",
      "Мерчендайзер | Функции",
      "Кассир",
      "Кассир | Функции",
      "Завсклад",
      "Зав.Склад | Функции",
      "All",
      "Доступ админ",
    ],
  },
}

// --- raw ---------------------------------------------------------------------------------------------------------------

/** A raw list (a plain array or a paged {results}), or null when the download does not have it. */
function list(name) {
  if (!hasRaw(name)) return null
  const data = raw(name)
  return Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : []
}

const text = (value) => (value === null || value === undefined ? "" : String(value).trim())
const flag = (value) => (value ? 1 : 0)
const refId = (value) => {
  const id = Number(value && typeof value === "object" ? value.id : value)
  return Number.isInteger(id) && id > 0 ? id : null
}
const idsOf = (values) => (Array.isArray(values) ? values.map(refId).filter((id) => id !== null) : [])
const point = (location, key) => {
  const value = location && typeof location === "object" ? Number(location[key]) : NaN
  return Number.isFinite(value) ? value : null
}
const nameKey = (value) => text(value).toLowerCase()

const currencies = list("currencies")
const config = hasRaw("config") ? raw("config") : null
const divisions = list("divisions") ?? list("fin_divisions")
const branches = list("branches")
const stocks = list("stocks")
const jobs = list("jobs")
const positions = list("positions")
const groupList = list("groups")
const locations = list("start_locations_all") ?? list("start_locations")
const employeeLists = ["employees_all", "employees_active", "employees_inactive"].map(list).filter(Boolean)
const cards = hasRaw("employees_detail") ? raw("employees_detail") : {}
const subscriptions = list("subscriptions")
const packages = list("billing")

// Linko's groups: its list, and the groups its positions name (a name from the list wins).
const groups = (() => {
  if (!groupList && !positions) return null
  const byId = new Map()
  for (const group of groupList ?? []) if (refId(group)) byId.set(refId(group), text(group.name))
  for (const position of positions ?? []) {
    for (const group of position.groups ?? []) if (refId(group) && !byId.has(refId(group)) && typeof group === "object") byId.set(refId(group), text(group.name))
  }
  return [...byId].map(([id, name]) => ({ id, name: GROUP_NAMES[name] ?? name, linkoName: name }))
})()

// Employees: the list rows (all, active, inactive; the first one of an id wins) and every card.
const people = new Map()
for (const rows of employeeLists) for (const row of rows) if (refId(row) && !people.has(refId(row))) people.set(refId(row), { row, card: null })
for (const [id, card] of Object.entries(cards ?? {})) {
  if (!card || typeof card !== "object" || !refId(card)) continue
  const entry = people.get(Number(id)) ?? { row: null, card: null }
  entry.card = card
  people.set(Number(id), entry)
}

// --- the app's lazily created tables ------------------------------------------------------------------------------------

const schema = spawnSync(
  process.execPath,
  [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "--conditions=react-server", "--tsconfig", path.join(ROOT, "tsconfig.json"), path.join(here, "ensure-org-people-schema.ts")],
  { stdio: "inherit", env: process.env },
)
if (schema.status !== 0) {
  console.error("org-people: ensure-org-people-schema.ts failed; nothing imported")
  process.exit(1)
}

// --- writes -------------------------------------------------------------------------------------------------------------

const run = runId("base-org-people")
const stats = counter()
const notes = []
const client = await connect()
await ensureRegistry(client)

function same(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-9
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b)
  return String(a) === String(b)
}

/** Current rows of `table` by id (all of them, or those with `ids`). */
async function snapshot(table, ids = null) {
  const rows = ids
    ? (await client.query(`SELECT * FROM ${table} WHERE id = ANY($1::int[])`, [ids])).rows
    : (await client.query(`SELECT * FROM ${table}`)).rows
  return new Map(rows.map((row) => [Number(row.id), row]))
}

/**
 * Inserts the row `id` of `table` with `values` (+ `insertOnly`), or updates the columns of `values` that differ from
 * `current` (the row as it was before this run: its previous values are registered); `touch` also sets updated_at.
 */
async function put(table, id, values, current, { insertOnly = {}, touch = false } = {}) {
  if (!current) {
    const all = { id, ...values, ...insertOnly }
    const cols = Object.keys(all)
    await client.query(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
      cols.map((c) => all[c]),
    )
    await register(client, run, table, id, "insert")
    stats.add(table, "insert")
    return "insert"
  }
  const changed = Object.keys(values).filter((c) => !same(current[c], values[c]))
  if (!changed.length) {
    stats.add(table, "same")
    return "same"
  }
  const sets = changed.map((c, i) => `"${c}" = $${i + 2}`)
  if (touch) sets.push("updated_at = datetime('now')")
  await client.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1`, [id, ...changed.map((c) => values[c])])
  await register(client, run, table, id, "update", Object.fromEntries(changed.map((c) => [c, current[c]])))
  stats.add(table, "update")
  return "update"
}

async function indexExists(name) {
  return (await client.query("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = $1", [name])).rowCount > 0
}

/**
 * Linko's rows of a table whose names are unique (`index`: case- and space-insensitive, as the app's index; or the
 * exact UNIQUE of capabilities.name): Linko twins drop the app's index (the app skips it while twins exist); a kept
 * local row (not Linko's) holding a Linko name stops the run. Rows whose name changes first get a temporary unique
 * name, so names moving between rows (a default «Админ» at Linko's id of «Оператор») never collide.
 */
async function putNamed(table, rows, { index, exact = false, insertOnly = () => ({}), touch = false }) {
  const key = (value) => (exact ? String(value) : nameKey(value))
  const seen = new Map()
  const twins = []
  for (const row of rows) {
    const k = key(row.values.name)
    if (seen.has(k)) twins.push(`${row.values.name} (${seen.get(k)}, ${row.id})`)
    else seen.set(k, row.id)
  }
  if (twins.length) {
    if (exact) throw new Error(`${table}: Linko has rows of the same name, which the table's UNIQUE name refuses: ${twins.join("; ")}`)
    if (index && (await indexExists(index))) {
      await client.query(`DROP INDEX IF EXISTS ${index}`)
      notes.push(`${table}: Linko has rows of the same name (${twins.join("; ")}), so the app's ${index} was dropped (the app skips it while twins exist)`)
    }
  }
  const current = await snapshot(table)
  const linko = new Set(rows.map((row) => row.id))
  const clash = [...current.values()].filter((row) => !linko.has(Number(row.id)) && seen.has(key(row.name)))
  if (clash.length) {
    throw new Error(
      `${table}: local rows Linko does not have hold Linko's names (${clash.map((row) => `#${row.id} ${row.name}`).join(", ")}); ` +
        "they are still referenced, so they were not removed: rename them in the app first",
    )
  }
  const moving = rows.filter((row) => current.has(row.id) && String(current.get(row.id).name) !== String(row.values.name)).map((row) => row.id)
  if (moving.length) await client.query(`UPDATE ${table} SET name = chr(1) || id::text WHERE id = ANY($1::int[])`, [moving])
  for (const row of rows) await put(table, row.id, row.values, current.get(row.id), { insertOnly: insertOnly(row), touch })
}

/** Removes the app's default rows of `table` that Linko does not have (by id) and that `referenced` does not keep. */
async function removeDefaults(table, linkoIds, referenced) {
  const seed = DEFAULTS[table]
  const mark = (await tableExists(client, "app_settings"))
    ? (await client.query("SELECT value FROM app_settings WHERE key = $1", [seed.mark])).rows[0]?.value
    : null
  if (mark !== "written") return
  const names = new Set(seed.names)
  for (const row of (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows) {
    if (linkoIds.has(Number(row.id)) || !names.has(String(row.name))) continue
    const use = await referenced(Number(row.id))
    if (use) {
      notes.push(`${table} #${row.id} ${row.name}: an app default Linko does not have, kept (${use})`)
      continue
    }
    await client.query(`DELETE FROM ${table} WHERE id = $1`, [row.id])
    await register(client, run, table, row.id, "delete", row)
    stats.del(table, 1)
  }
}

/** How many rows of `table` hold `id` in their JSON id list `column` (0 without the table or the column). */
async function jsonListHas(table, column, id) {
  if (!(await tableExists(client, table)) || !(await columnExists(client, table, column))) return 0
  const rows = (await client.query(`SELECT ${column} AS ids FROM ${table} WHERE ${column} LIKE $1`, [`%${id}%`])).rows
  return rows.filter((row) => {
    try {
      const ids = JSON.parse(row.ids || "[]")
      return Array.isArray(ids) && ids.some((value) => Number(value) === id)
    } catch {
      return false
    }
  }).length
}

async function countWhere(table, column, id) {
  if (!(await tableExists(client, table)) || !(await columnExists(client, table, column))) return 0
  return Number((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [id])).rows[0].n)
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(value || "{}")
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

try {
  await client.query("BEGIN")
  // The first copy's start_locations (no app module creates it; lib/employees-options.ts and the employee form read it).
  await client.query(`CREATE TABLE IF NOT EXISTS start_locations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL DEFAULT 0,
    lon DOUBLE PRECISION NOT NULL DEFAULT 0
  )`)

  // --- currencies --------------------------------------------------------------------------------------------------------
  if (currencies) {
    const primary = refId(config?.PRIMARY_CURRENCY_ID)
    const linkoIds = new Set(currencies.map(refId).filter(Boolean))
    let base = null
    for (const c of currencies) {
      const id = refId(c)
      if (!id) continue
      const code = currencyCode({ name: c.name })
      // A local row of the same code under another id (the app's default SOM of a new company) takes Linko's id while
      // no rate history refers to it.
      const twin = (await client.query("SELECT * FROM currencies WHERE upper(btrim(code)) = $1 AND id <> $2", [code, id])).rows[0]
      if (twin) {
        if (linkoIds.has(Number(twin.id)) || (await countWhere("currency_rates", "currency_id", Number(twin.id))) || (await snapshot("currencies", [id])).size) {
          throw new Error(`currencies: the local #${twin.id} ${twin.name} has Linko's code ${code} of #${id}; merge them in Валюты first`)
        }
        await client.query("UPDATE currencies SET id = $1 WHERE id = $2", [id, twin.id])
        await register(client, run, "currencies", id, "update", { id: twin.id })
        notes.push(`currencies: the local #${twin.id} (${code}) took Linko's id ${id}`)
      }
      const rate = Number(c.rate && typeof c.rate === "object" ? c.rate.rate : c.rate)
      const isBase = primary ? id === primary : code === "SUM"
      if (isBase) base = id
      const current = (await snapshot("currencies", [id])).get(id)
      const displayName = CURRENCY_NAMES[code] ?? (text(c.name) || code)
      const values = {
        code,
        rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
        is_base: flag(isBase),
        created_at: sqlDateTime(c.created_date) ?? sqlDateTime(new Date().toISOString()),
        updated_at: sqlDateTime(c.rate?.created_date) ?? sqlDateTime(c.created_date) ?? sqlDateTime(new Date().toISOString()),
      }
      // The stored name stays, unless the row held another currency (its code changes with it).
      if (current && String(current.code).trim().toUpperCase() !== code) values.name = displayName
      await put("currencies", id, values, current, { insertOnly: { name: displayName } })
    }
    // One base currency: Linko's.
    if (base) {
      for (const row of (await client.query("SELECT id, is_base FROM currencies WHERE is_base = 1 AND id <> $1", [base])).rows) {
        await client.query("UPDATE currencies SET is_base = 0 WHERE id = $1", [row.id])
        await register(client, run, "currencies", row.id, "update", { is_base: row.is_base })
        stats.add("currencies", "update")
      }
    }
    await bumpSequence(client, "currencies")
  } else notes.push("currencies: not in the download, left as they are")

  // --- organizations (Linko's divisions) ---------------------------------------------------------------------------------
  if (divisions) {
    const current = await snapshot("organizations")
    for (const d of divisions) {
      const id = refId(d)
      if (!id) continue
      await put(
        "organizations",
        id,
        { name: text(d.name), limit_by_debt: flag(d.use_limit_for_debt), created_at: sqlDateTime(d.created_date) ?? sqlDateTime(new Date().toISOString()) },
        current.get(id),
        { touch: true },
      )
    }
    await bumpSequence(client, "organizations")
  } else notes.push("organizations: divisions not in the download")

  // --- branches ----------------------------------------------------------------------------------------------------------
  if (branches) {
    const rows = branches
      .filter((b) => refId(b))
      .map((b) => ({
        id: refId(b),
        values: {
          name: text(b.name),
          price_list: text(b.price_list?.name),
          currency: b.currency ? currencyCode({ name: typeof b.currency === "object" ? b.currency.name : b.currency }) : "",
          debt_tracking: flag(b.show_balance),
          is_main: flag(b.is_main),
          location_lat: point(b.location, "lat"),
          location_lng: point(b.location, "lon"),
          created_at: sqlDateTime(b.created_date) ?? sqlDateTime(new Date().toISOString()),
        },
      }))
    await putNamed("branches", rows, { index: "branches_name_key", touch: true })
    await bumpSequence(client, "branches")
  } else notes.push("branches: not in the download")

  // --- Должности (jobs) --------------------------------------------------------------------------------------------------
  if (jobs) {
    const rows = jobs.filter((j) => refId(j)).map((j) => ({ id: refId(j), values: { name: text(j.name), created_at: sqlDateTime(j.created_date) ?? sqlDateTime(new Date().toISOString()) } }))
    const linkoIds = new Set(rows.map((row) => row.id))
    await removeDefaults("job_positions", linkoIds, async (id) => {
      const employees = await countWhere("employees", "job_id", id)
      const articles = await countWhere("knowledge_base_article_positions", "position_id", id)
      return employees || articles ? `employees ${employees}, База знания ${articles}` : ""
    })
    await putNamed("job_positions", rows, { index: "job_positions_name_key", touch: true })
    await bumpSequence(client, "job_positions")
  } else notes.push("job_positions: jobs not in the download")

  // --- Права доступа (positions) and their Возможности (groups) ---------------------------------------------------------
  if (positions) {
    const rightIds = new Set(positions.map(refId).filter(Boolean))
    await removeDefaults("access_rights", rightIds, async (id) => {
      const counts = {
        users: await countWhere("users", "access_right_id", id),
        employees: await countWhere("employees", "access_right_id", id),
        widgets: await jsonListHas("dashboard_widgets", "access_right_ids", id),
        articles: await countWhere("knowledge_base_article_access_rights", "access_right_id", id),
      }
      return Object.values(counts).some(Boolean) ? JSON.stringify(counts) : ""
    })
  }
  if (groups) {
    const groupIds = new Set(groups.map((g) => g.id))
    await removeDefaults("capabilities", groupIds, async (id) => {
      const rights = await jsonListHas("access_rights", "capability_ids", id)
      return rights ? `access rights ${rights}` : ""
    })
    const renamed = groups.filter((g) => g.name !== g.linkoName)
    // A built-in group's translated name taken by another Linko group keeps its key (no two capabilities share a name).
    const taken = new Set(groups.filter((g) => g.name === g.linkoName).map((g) => g.name))
    for (const g of renamed) {
      if (taken.has(g.name)) {
        notes.push(`capabilities #${g.id}: «${g.name}» is another Linko group's name, kept as «${g.linkoName}»`)
        g.name = g.linkoName
      }
    }
    await putNamed(
      "capabilities",
      groups.map((g) => ({ id: g.id, values: { name: g.name } })),
      { exact: true, insertOnly: () => ({ permission_ids: "[]" }), touch: true },
    )
    await bumpSequence(client, "capabilities")
  } else notes.push("capabilities: groups not in the download")
  if (positions) {
    const rows = positions
      .filter((p) => refId(p))
      .map((p) => ({
        id: refId(p),
        values: {
          name: text(p.name),
          capability_ids: JSON.stringify(idsOf(p.groups)),
          created_at: sqlDateTime(p.created_date) ?? sqlDateTime(new Date().toISOString()),
        },
      }))
    await putNamed("access_rights", rows, { index: "access_rights_name_key", touch: true })
    await bumpSequence(client, "access_rights")
  } else notes.push("access_rights: positions not in the download")

  // --- start locations ---------------------------------------------------------------------------------------------------
  if (locations) {
    const current = await snapshot("start_locations")
    for (const l of locations) {
      const id = refId(l)
      if (!id) continue
      await put("start_locations", id, { name: text(l.name), lat: point(l.location, "lat") ?? 0, lon: point(l.location, "lon") ?? 0 }, current.get(id))
    }
  } else notes.push("start_locations: not in the download")

  // --- employees ---------------------------------------------------------------------------------------------------------
  const names = async (table) => new Map((await client.query(`SELECT id, name FROM ${table}`)).rows.map((row) => [Number(row.id), String(row.name)]))
  const rightNames = await names("access_rights")
  const jobNames = (await tableExists(client, "job_positions")) ? await names("job_positions") : new Map()
  const branchNames = await names("branches")
  const organizationNames = await names("organizations")
  const currentEmployees = await snapshot("employees")
  const unknown = { rights: new Set(), jobs: new Set() }
  for (const [id, { row, card }] of people) {
    const src = card ?? row
    const values = {
      first_name: text(src.first_name),
      last_name: text(src.second_name),
      login: text(src.username),
      phone: text(src.phone_number),
      active: flag(src.is_active),
      system_access: src.is_blocked ? 0 : 1,
      two_step_check: flag(src.verify_by_sms),
    }
    const rightId = refId(src.position)
    const jobId = refId(src.job)
    if (rightId && !rightNames.has(rightId)) unknown.rights.add(rightId)
    if (jobId && !jobNames.has(jobId)) unknown.jobs.add(jobId)
    values.access_right_id = rightId && rightNames.has(rightId) ? rightId : null
    values.job_id = jobId && jobNames.has(jobId) ? jobId : null
    values.position = [rightNames.get(values.access_right_id), jobNames.get(values.job_id)].map(text).filter(Boolean).join(" · ")
    const accesses = Array.isArray(row?.accesses) ? row.accesses : Array.isArray(card?.accesses) ? card.accesses : null
    const shift = row && "shift" in row ? row.shift : card?.shift
    const linkoDetails = {}
    if (card) {
      const branchIds = idsOf(card.branches)
      const organizationIds = idsOf(card.divisions)
      Object.assign(values, {
        integration_code: text(card.service_id),
        branch: branchIds.length ? (branchNames.get(branchIds[0]) ?? text(card.branches[0]?.name)) : "",
        show_in_tracking: flag(card.track_the_plan),
        session_limit: flag(card.one_active_device),
        gps_check: card.disable_gps ? 0 : 1,
        start_point: Array.isArray(card.location_points) && card.location_points.length ? 1 : 0,
        organizations: JSON.stringify(organizationIds.map((orgId, i) => organizationNames.get(orgId) ?? text(card.divisions[i]?.name))),
        branch_ids: JSON.stringify(branchIds),
        organization_ids: JSON.stringify(organizationIds),
      })
      Object.assign(linkoDetails, {
        supervisorId: refId(card.supervisor),
        deliveryManId: refId(card.delivery_man),
        auditAgentIds: idsOf(card.agents),
        stockIds: idsOf(card.stocks),
        requestStockIds: idsOf(card.request_stocks),
        priceListIds: idsOf(card.price_lists),
        marketPriceListIds: idsOf(card.market_price_lists),
        currencyIds: idsOf(card.currencies),
        locationPointIds: idsOf(card.location_points),
        cashboxIds: idsOf(card.cashboxes),
        requestCashboxIds: idsOf(card.request_cashboxes),
      })
    }
    linkoDetails.shiftId = refId(shift)
    if (card) {
      linkoDetails.isPos = Boolean(card.is_pos)
      linkoDetails.trackThePlan = Boolean(card.track_the_plan)
    }
    if (accesses) {
      linkoDetails.accesses = accesses.map((a) => ({
        name: text(a?.name),
        status: a?.status ?? null,
        fromTime: a?.from_time ?? null,
        toTime: a?.to_time ?? null,
        isAll: Boolean(a?.is_all),
      }))
    }
    linkoDetails.isSuperuser = Boolean(src.is_superuser)
    const current = currentEmployees.get(id)
    values.details = JSON.stringify({ ...parseObject(current?.details), ...linkoDetails })
    await put("employees", id, values, current, { touch: true })
  }
  if (unknown.rights.size) notes.push(`employees: access rights not in Linko's positions list, left empty: ${[...unknown.rights].join(", ")}`)
  if (unknown.jobs.size) notes.push(`employees: jobs not in Linko's jobs list, left empty: ${[...unknown.jobs].join(", ")}`)
  const others = [...currentEmployees.keys()].filter((id) => !people.has(id))
  if (others.length) notes.push(`employees: ${others.length} local employees Linko does not list, left as they are`)
  await bumpSequence(client, "employees")

  // --- warehouses (Linko's stocks) ---------------------------------------------------------------------------------------
  if (stocks) {
    const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
    const current = await snapshot("warehouses")
    for (const s of stocks) {
      const id = refId(s)
      if (!id) continue
      const managerId = refId(s.stock_manager)
      await put(
        "warehouses",
        id,
        {
          name: text(s.name),
          full_name: text(s.full_name),
          address: text(s.address),
          branch: text(s.branch?.name ?? (refId(s.branch) ? branchNames.get(refId(s.branch)) : "")),
          manager: s.stock_manager && typeof s.stock_manager === "object" ? fullName(s.stock_manager) : "",
          manager_id: managerId && employees.has(managerId) ? managerId : null,
          stock_type: text(s.stock_type) || "basic",
          online: flag(s.is_van_sell),
          for_return: flag(s.for_return),
          track_min_amount: flag(s.track_min_amount),
          active: s.is_active === false ? 0 : 1,
          comment: text(s.comment),
          lat: point(s.location, "lat"),
          lon: point(s.location, "lon"),
          created_date: ruShortDate(s.created_date),
          created_at: utcText(s.created_date) ?? sqlDateTime(new Date().toISOString()),
        },
        current.get(id),
        { touch: true },
      )
    }
    await bumpSequence(client, "warehouses")
  } else notes.push("warehouses: stocks not in the download")

  // --- Подписки: each employee's license and the purchased packages (Linko's whole lists) ---------------------------------
  if (subscriptions) {
    const wanted = new Map()
    for (const s of subscriptions) {
      const employeeId = refId(s)
      if (!employeeId || !s.license?.key) continue
      wanted.set(employeeId, {
        license_key: text(s.license.key),
        license_name: text(s.license.name),
        begin_date: s.begin_date ?? null,
        end_date: s.end_date ?? null,
        price: Number(s.price) || 0,
      })
    }
    const current = new Map((await client.query("SELECT * FROM employee_subscriptions ORDER BY seq")).rows.map((row) => [Number(row.employee_id), row]))
    for (const [employeeId, row] of current) {
      if (wanted.has(employeeId)) continue
      await client.query("DELETE FROM employee_subscriptions WHERE employee_id = $1", [employeeId])
      await register(client, run, "employee_subscriptions", employeeId, "delete", row)
      stats.del("employee_subscriptions", 1)
    }
    for (const [employeeId, values] of wanted) {
      const before = current.get(employeeId)
      if (!before) {
        await client.query(
          "INSERT INTO employee_subscriptions (employee_id, license_key, license_name, begin_date, end_date, price) VALUES ($1, $2, $3, $4, $5, $6)",
          [employeeId, values.license_key, values.license_name, values.begin_date, values.end_date, values.price],
        )
        await register(client, run, "employee_subscriptions", employeeId, "insert")
        stats.add("employee_subscriptions", "insert")
        continue
      }
      const changed = Object.keys(values).filter((c) => !same(before[c], values[c]))
      if (!changed.length) {
        stats.add("employee_subscriptions", "same")
        continue
      }
      await client.query(`UPDATE employee_subscriptions SET ${changed.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE employee_id = $1`, [
        employeeId,
        ...changed.map((c) => values[c]),
      ])
      await register(client, run, "employee_subscriptions", employeeId, "update", Object.fromEntries(changed.map((c) => [c, before[c]])))
      stats.add("employee_subscriptions", "update")
    }
  } else notes.push("employee_subscriptions: subscriptions not in the download")
  if (packages) {
    const wanted = packages.map((p) => ({
      license_key: text(p.license?.key),
      license_name: text(p.license?.name),
      begin_date: text(p.begin_date),
      end_date: text(p.end_date),
      total: Number(p.count) || 0,
      available: p.available === null || p.available === undefined ? null : Number(p.available),
    }))
    const columns = Object.keys(wanted[0] ?? { license_key: "" })
    const current = (await client.query("SELECT * FROM billing_packages ORDER BY id")).rows
    const unchanged = current.length === wanted.length && current.every((row, i) => columns.every((c) => same(row[c], wanted[i][c])))
    if (unchanged) stats.add("billing_packages", "same")
    else {
      // Linko's packages have no id: the list is replaced as a whole, in Linko's order.
      await client.query("DELETE FROM billing_packages")
      for (const p of wanted) {
        await client.query(`INSERT INTO billing_packages (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, columns.map((c) => p[c]))
      }
      await register(client, run, "billing_packages", "all", "replace", current)
      stats.add("billing_packages", "update")
    }
  } else notes.push("billing_packages: billing not in the download")

  if (DRY) {
    await client.query("ROLLBACK")
    stats.print("org-people (DRY=1, rolled back):")
  } else {
    await client.query("COMMIT")
    stats.print(
      `org-people: currencies ${currencies?.length ?? "-"}, divisions ${divisions?.length ?? "-"}, branches ${branches?.length ?? "-"}, stocks ${stocks?.length ?? "-"}, ` +
        `jobs ${jobs?.length ?? "-"}, positions ${positions?.length ?? "-"}, groups ${groups?.length ?? "-"}, start locations ${locations?.length ?? "-"}, ` +
        `employees ${people.size}, subscriptions ${subscriptions?.length ?? "-"}, packages ${packages?.length ?? "-"} (Linko)`,
    )
  }
  for (const note of notes) console.log(`  note: ${note}`)
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
