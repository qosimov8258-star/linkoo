// The BASE rows of the clients' side of a Linko account, which the other steps only update and attach their rows to:
//   client_types                   Типы клиентов ← market/market_type (by Linko id): name, parent, «Доставщик»
//                                  (supplier, the type's delivery man), «ИНН обязателен». A type a shop names that the
//                                  list leaves out (deleted in Linko) is added from the shop.
//   store_categories               Категории клиентов ← market/category (by Linko id)
//   client_attributes / _values    Атрибуты клиента ← market/options: field type, «Обязательное», cache number, the
//                                  choice values. Matched by name (shops' values and choice values name the attribute,
//                                  the first copy numbered them in Linko's list order); a new one gets Linko's id. The
//                                  values a shop carries are written by import-client-options.mjs.
//   client_classification_classes  Классификация ← market/market_classification: Linko's classes with a limit (its last,
//                                  limitless class is the app's implicit «Больше»), replacing the list when it differs.
//                                  Linko without classes leaves the app's default classes alone (the app seeds an
//                                  empty table again).
//   clients                        the shops ← market/market (clients.id = Linko's market id, as every step expects):
//                                  name, type, zone (the territory's title), branch, agent / delivery man / collector,
//                                  address, «Ориентир», contact, code (Linko's, else the id), INN, sales channel, tab
//                                  (closed → «Закрытие», not confirmed → «Не подтвержденные», else «Плановый ОКБ»),
//                                  route flag (a Linko visit plan), created / modified moments (Tashkent wall clock;
//                                  the modified one moves only with a change). An empty INN stays as stored.
//                                  The map point is written when the shop is new or has none (import-shop-state.mjs
//                                  keeps it after that). With the shops' details (shop_drawer.json, fetch-shop-drawer)
//                                  also the phones, «Примечание», «Автоматическая доставка», «Безлимитный долг» and
//                                  «Создал»: Linko's list has none of them.
//   financial_accounts             Финансовые счета ← sales/client (by Linko id): name, address, created moment; a new
//                                  account gets the agent and type of its own shop (the shop with the account's id),
//                                  as the first copy has them (Linko's account has neither). An account a shop names
//                                  that the list leaves out is kept as deleted.
//   financial_account_markets      which account each shop belongs to (the shop's `client`)
//   client_restrictions            Ограничения ← market/restriction (by Linko id): name, subject type, «Мин. количество»;
//                                  the clients and products of a restriction (its detail) are not in the download, so
//                                  what the copy has of them is kept.
// The rest of a shop comes from the steps after this one: territories (import-zones.mjs, client_zones by Linko id),
// account links of deleted accounts (import-account-links.mjs), attribute values (import-client-options.mjs), active /
// closed / point / «Реализация по» (import-shop-state.mjs, import-shop-closed.mjs), last order / visit days
// (import-market-activity.mjs), the card (import-shop-drawer.mjs), agents (import-market-users.mjs, import-zone-agents.mjs),
// Telegram bot users (import-settings-lists.mjs). Linko's debt limits (market/debt_limit) are not downloaded.
//
// First the app creates the lazily made tables itself (this file again under tsx, calling the repositories' ensure
// functions, which only create and read). Rows are written by Linko's id (attributes: by name); a re-run changes only
// what differs and logs it in linko_sync_rows. A type or category made in the app under a Linko name (an id Linko does
// not have) gives way to Linko's row, as in import-zones.mjs.
//
//   node scripts/linko-sync/import-base-clients.mjs      (RAW / TARGET_DB as for every importer)
//   raw: markets, clients (required); market_types, market_categories, market_options, market_classification,
//        market_restrictions, market_plans (each optional); shop_drawer.json when the download has it
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ROOT, appDatabase, bumpSequence, captured, connect, ensureRegistry, fullName, hasRaw, raw, register, runId, sqlDateTime, upsertById } from "./lib.mjs"

const SELF = fileURLToPath(import.meta.url)
const TABLES_STEP = "LINKO_BASE_CLIENTS_TABLES"

if (process.env[TABLES_STEP] === "1") {
  await createAppTables()
  process.exit(0)
}

/** Under tsx: the app's own code creates the client tables it would create on first use (each call creates, then only
 * reads), in the database this run writes to. */
async function createAppTables() {
  const db = await appDatabase()
  const [clients, types, attributes, classification, categories, restrictions, telegram, limits, accounts] = await Promise.all([
    import("@/lib/clients-repo"),
    import("@/lib/client-types-repo"),
    import("@/lib/client-attributes-repo"),
    import("@/lib/client-classification-repo"),
    import("@/lib/store-categories-repo"),
    import("@/lib/client-restrictions-repo"),
    import("@/lib/telegram-users-repo"),
    import("@/lib/client-debt-limits-repo"),
    import("@/lib/financial-accounts-repo"),
  ])
  await clients.ensureClientsSchema()
  await types.listClientTypes()
  await attributes.ensureClientAttributesSchema()
  await classification.getClassificationClasses()
  await categories.listStoreCategories()
  await restrictions.listClientRestrictions()
  await telegram.listTelegramUsers()
  await limits.listClientDebtLimits(0)
  await accounts.listFinancialAccounts()
  console.log(`base clients: the app's client tables are in place in ${db}`)
}

function runTablesStep() {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "--conditions=react-server", "--tsconfig", path.join(ROOT, "tsconfig.json"), SELF],
    { stdio: "inherit", env: { ...process.env, [TABLES_STEP]: "1" } },
  )
  if (result.status !== 0) throw new Error(`base clients: the app could not create its client tables (exit ${result.status ?? result.signal})`)
}

const run = runId("base-clients")
const optional = (name) => (hasRaw(name) ? raw(name) : null)
const markets = [...raw("markets")].sort((a, b) => a.id - b.id)
const accounts = [...raw("clients")].sort((a, b) => a.id - b.id)
const marketTypes = optional("market_types")
const marketCategories = optional("market_categories")
const marketOptions = optional("market_options")
const marketClasses = optional("market_classification")
const marketRestrictions = optional("market_restrictions")
const marketPlans = optional("market_plans")

/** Each shop's detail (market/market/<id>/), when RAW has the shops' details: Map(shop id → detail). */
function readDrawer() {
  const file = captured("shop_drawer.json")
  if (!file || !fs.existsSync(file)) return null
  const body = JSON.parse(fs.readFileSync(file, "utf8"))
  const details = new Map()
  for (const [id, entry] of Object.entries(body.data ?? {})) if (entry?.market) details.set(Number(entry.market.id ?? id), entry.market)
  return { details, source: path.relative(ROOT, file) }
}
const drawer = readDrawer()

const NOT_SET = "Не указано"
const person = (user) => fullName(user) || NOT_SET
const text = (value) => (value == null ? "" : String(value).trim())
const nameKey = (value) => String(value ?? "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()
/** keySql of lib/platform-refs.ts: the name key the unique indexes of the directories use. */
const keySql = (expression) => `lower(btrim(regexp_replace(replace(replace(coalesce(${expression}, ''), chr(160), ' '), chr(8239), ' '), '\\s+', ' ', 'g')))`
/** A phone list as its numbers' last nine digits (the app's duplicate check reads them the same way). */
const phoneDigits = (value) =>
  String(value ?? "")
    .split(",")
    .map((part) => part.replace(/\D/g, "").slice(-9))
    .filter(Boolean)
    .join(",")
const FIELD_TYPES = { select: "Выбор вариантов", number: "Цифровое поле", text: "Текстовое поле", date: "Дата выборки" }
const RESTRICTION_SUBJECTS = { market: "Клиент" }

/** Names unique by key (Linko allows twins, the directories do not): a repeated name gets " (2)" … */
function uniqueNames(rows, nameOf) {
  const used = new Map()
  const names = new Map()
  const renamed = []
  for (const row of rows) {
    const base = text(nameOf(row)) || `#${row.id}`
    const n = (used.get(nameKey(base)) ?? 0) + 1
    used.set(nameKey(base), n)
    const name = n === 1 ? base : `${base} (${n})`
    if (n > 1) renamed.push(`${row.id}:${name}`)
    names.set(row.id, name)
  }
  return { names, renamed }
}

/** Rows made here (an id Linko does not have) under one of Linko's names give way to Linko's row; returns how many. */
async function giveWay(client, table, key, names) {
  const linkoIds = [...names.keys()]
  let removed = 0
  for (const [, name] of names) {
    const sql = `DELETE FROM ${table} WHERE ${key("name")} = ${key("$1::text")} AND NOT (id = ANY($2::int[])) RETURNING *`
    const rows = (await client.query(sql, [name, linkoIds])).rows
    for (const row of rows) await register(client, run, table, row.id, "delete", row)
    removed += rows.length
  }
  return removed
}

const tally = () => ({ insert: 0, update: 0, same: 0 })
const stats = {
  types: { ...tally(), fromShops: 0, gaveWay: 0, renamed: [] },
  categories: { ...tally(), gaveWay: 0, renamed: [] },
  attributes: { ...tally(), renamed: [], values: 0, valuesRemoved: 0 },
  classes: "not in RAW",
  clients: { ...tally(), withDetail: 0 },
  accounts: { ...tally(), deletedFromShops: 0 },
  links: tally(),
  restrictions: tally(),
}

runTablesStep()
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  // The app's lock of client writes (lib/clients-repo.ts lockClients).
  await client.query("SELECT pg_advisory_xact_lock(72120936)")

  // --- Типы клиентов ---------------------------------------------------------------------------------------------
  const typeRows = new Map((marketTypes ?? []).map((type) => [type.id, type]))
  for (const market of markets) {
    const type = market.market_type
    if (type?.id && !typeRows.has(type.id)) {
      typeRows.set(type.id, { id: type.id, name: type.name, parent: type.parent ?? null })
      stats.types.fromShops++
    }
  }
  const types = [...typeRows.values()].sort((a, b) => a.id - b.id)
  const typeNames = uniqueNames(types, (type) => type.name)
  stats.types.renamed = typeNames.renamed
  stats.types.gaveWay = await giveWay(client, "client_types", (e) => `lower(btrim(${e}))`, typeNames.names)
  for (const type of types) {
    const parentId = typeof type.parent === "object" ? type.parent?.id : type.parent
    const values = {
      name: typeNames.names.get(type.id),
      supplier: person(type.delivery_man),
      parent_id: parentId && typeRows.has(parentId) ? parentId : null,
      inn_required: type.inn_required ? 1 : 0,
    }
    if (type.created_date) values.created_at = sqlDateTime(type.created_date)
    stats.types[await upsertById(client, run, "client_types", type.id, values)]++
  }

  // --- Категории клиентов ----------------------------------------------------------------------------------------
  if (marketCategories) {
    const categories = [...marketCategories].sort((a, b) => a.id - b.id)
    const names = uniqueNames(categories, (category) => category.name)
    stats.categories.renamed = names.renamed
    stats.categories.gaveWay = await giveWay(client, "store_categories", keySql, names.names)
    for (const category of categories) stats.categories[await upsertById(client, run, "store_categories", category.id, { name: names.names.get(category.id) })]++
  }

  // --- Атрибуты клиента and their choice values --------------------------------------------------------------------
  // Matched by name (the shops' values and the choice values name the attribute): the row with Linko's id while it
  // carries this name or a name Linko no longer has (renamed there), else the row of this name (Linko's twins: the
  // n-th row of the name, or "<name> (n)"), else a new row under Linko's id (the next free id when that one is taken).
  if (marketOptions) {
    const options = [...marketOptions].sort((a, b) => a.id - b.id)
    const rows = (await client.query("SELECT id, name FROM client_attributes ORDER BY id")).rows
    const linkoKeys = new Set(options.map((option) => nameKey(text(option.name) || `#${option.id}`)))
    const taken = new Set()
    const seen = new Map()
    for (const option of options) {
      const base = text(option.name) || `#${option.id}`
      const nth = (seen.get(nameKey(base)) ?? 0) + 1
      seen.set(nameKey(base), nth)
      const target = nth === 1 ? base : `${base} (${nth})`
      const free = (row) => Boolean(row) && !taken.has(row.id)
      const own = rows.find((row) => row.id === option.id)
      const byName = rows.find((row) => free(row) && nameKey(row.name) === nameKey(base)) ?? (nth > 1 ? rows.find((row) => free(row) && nameKey(row.name) === nameKey(target)) : null)
      let row = null
      if (free(own) && nameKey(own.name) === nameKey(target)) row = own
      else if (byName) row = byName
      else if (free(own) && !linkoKeys.has(nameKey(own.name))) row = own
      const cache = option.market_cache_number == null || option.market_cache_number === "" ? null : Number(option.market_cache_number)
      const values = {
        field_type: FIELD_TYPES[option.field_type] ?? FIELD_TYPES.select,
        required: option.is_required ? 1 : 0,
        market_cache_number: Number.isInteger(cache) ? cache : null,
      }
      let id
      if (row) {
        id = row.id
        // Linko's spelling on the row of its id (its choice values follow a rename, as the app's rename does); a row
        // adopted by name keeps its own.
        if (row === own) values.name = target
        if (row === own && nth > 1) stats.attributes.renamed.push(`${option.id}:${target}`)
        stats.attributes[await upsertById(client, run, "client_attributes", id, values)]++
        if (row === own && row.name !== target) {
          const moved = (await client.query("UPDATE client_attribute_values SET attribute = $2 WHERE attribute = $1 RETURNING id", [row.name, target])).rows
          for (const value of moved) await register(client, run, "client_attribute_values", value.id, "update", { attribute: row.name })
        }
      } else {
        id = own ? Number((await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM client_attributes")).rows[0].id) : option.id
        await upsertById(client, run, "client_attributes", id, { name: target, ...values })
        if (nth > 1) stats.attributes.renamed.push(`${option.id}:${target}`)
        rows.push({ id, name: target })
        stats.attributes.insert++
      }
      taken.add(id)
      const name = (await client.query("SELECT name FROM client_attributes WHERE id = $1", [id])).rows[0].name
      const choices = (option.values ?? []).map((value) => text(typeof value === "object" ? value?.value : value)).filter(Boolean)
      const stored = (await client.query("SELECT id FROM client_attribute_values WHERE attribute = $1 ORDER BY id", [name])).rows
      if (choices.length) {
        const valueId = stored[0]?.id ?? ((await client.query("SELECT 1 FROM client_attribute_values WHERE id = $1", [id])).rowCount ? null : id)
        if (valueId == null) {
          await bumpSequence(client, "client_attribute_values")
          const inserted = await client.query("INSERT INTO client_attribute_values (attribute, values_json) VALUES ($1, $2) RETURNING id", [name, JSON.stringify(choices)])
          await register(client, run, "client_attribute_values", inserted.rows[0].id, "insert")
        } else await upsertById(client, run, "client_attribute_values", valueId, { attribute: name, values_json: JSON.stringify(choices) })
        stats.attributes.values++
      } else if (stored.length) {
        const gone = (await client.query("DELETE FROM client_attribute_values WHERE attribute = $1 RETURNING *", [name])).rows
        for (const removed of gone) await register(client, run, "client_attribute_values", removed.id, "delete", removed)
        stats.attributes.valuesRemoved += gone.length
      }
    }
  }

  // --- Классификация -----------------------------------------------------------------------------------------------
  if (marketClasses) {
    const linko = marketClasses
      .filter((item) => item.limit != null && item.limit !== "" && Number.isFinite(Number(item.limit)))
      .map((item) => ({ name: text(item.name), amount: Number(item.limit) }))
      .sort((a, b) => a.amount - b.amount)
    const current = (await client.query("SELECT id, name, amount FROM client_classification_classes ORDER BY amount, id")).rows
    const same = current.length === linko.length && current.every((row, i) => row.name === linko[i].name && Number(row.amount) === linko[i].amount)
    if (!linko.length) stats.classes = `Linko has none: the ${current.length} classes here are kept`
    else if (same) stats.classes = `same (${linko.length})`
    else {
      await client.query("DELETE FROM client_classification_classes")
      for (const item of linko) await client.query("INSERT INTO client_classification_classes (name, amount) VALUES ($1, $2)", [item.name, item.amount])
      await register(client, run, "client_classification_classes", "all", "replace", current)
      stats.classes = `replaced (${current.length} → ${linko.length})`
    }
  }

  // --- Shops → clients ---------------------------------------------------------------------------------------------
  const planned = marketPlans ? new Set(marketPlans.map((plan) => plan.market?.id ?? plan.market).filter(Boolean)) : null
  for (const market of markets) {
    const detail = drawer?.details.get(market.id) ?? null
    const values = {
      name: text(market.name) || `#${market.id}`,
      inn: text(market.inn ?? detail?.inn) || null,
      type: text(market.market_type?.name),
      zone: text(market.border?.title),
      agent: person(market.responsible_agent),
      deliverer: person(market.responsible_delivery_man),
      collector: person(market.responsible_collector),
      tab: market.is_closed ? "closing" : market.is_confirmed === false ? "unconfirmed" : "plan",
      created_at: sqlDateTime(market.created_date) ?? "",
      branch: text(market.branch?.name ?? market.branch_name),
      sales_channel: text((market.channel_category ?? detail?.channel_category)?.name),
      address: text(market.address),
      landmark: text(market.guide),
      code: text(market.code) || String(market.id),
      contact_person: text(market.contact_name),
    }
    if (planned || detail) values.in_route = planned?.has(market.id) || (Array.isArray(detail?.with_plan) && detail.with_plan.length > 0) ? 1 : 0
    if (detail) {
      stats.clients.withDetail++
      values.phone = (detail.phones ?? []).map((entry) => text(typeof entry === "object" ? entry?.phone : entry)).filter(Boolean).join(", ")
      values.note = text(detail.note)
      values.auto_delivery = detail.auto_delivery ? 1 : 0
      values.unlimited_debt = detail.unlimited_debt ? 1 : 0
      values.created_by = fullName(detail.created_by)
    }
    const lat = Number(market.location?.lat)
    const lng = Number(market.location?.lon)
    const point = market.location?.lat != null && market.location?.lon != null && Number.isFinite(lat) && Number.isFinite(lng) ? { location_lat: lat, location_lng: lng } : null
    const current = (await client.query("SELECT inn, phone, location_lat, location_lng FROM clients WHERE id = $1", [market.id])).rows[0]
    // No INN either way ('' or NULL), the same numbers in another form (+998 or not): the stored form stays.
    if (current && values.inn == null && !text(current.inn)) values.inn = current.inn
    if (current && values.phone != null && phoneDigits(current.phone) === phoneDigits(values.phone)) values.phone = current.phone
    const pointValues = point && (!current || current.location_lat == null || current.location_lng == null) ? point : {}
    // updated_at: Linko's modified moment, moved only together with a change (a new shop: balance stays NULL, no
    // opening balance: Linko's ledger is copied by the finance steps).
    const modified = sqlDateTime(market.modified_date ?? market.created_date) ?? ""
    if (!current) stats.clients[await upsertById(client, run, "clients", market.id, { ...values, ...pointValues, updated_at: modified })]++
    else {
      const result = await upsertById(client, run, "clients", market.id, { ...values, ...pointValues })
      if (result === "update") await upsertById(client, run, "clients", market.id, { updated_at: modified })
      stats.clients[result]++
    }
  }

  // --- Финансовые счета and their shops ----------------------------------------------------------------------------
  const shopsById = new Map(markets.map((market) => [market.id, market]))
  const accountRows = new Map(accounts.map((account) => [account.id, { ...account, deleted: 0 }]))
  for (const market of markets) {
    const accountId = market.client?.id
    if (accountId && !accountRows.has(accountId)) {
      // An account Linko deleted (its list leaves it out) that a shop still names: kept, as deleted.
      accountRows.set(accountId, { id: accountId, name: market.client?.name ?? "", address: "", created_date: null, deleted: 1 })
      stats.accounts.deletedFromShops++
    }
  }
  for (const account of [...accountRows.values()].sort((a, b) => a.id - b.id)) {
    const own = shopsById.get(account.id)
    const ownShop = own && own.client?.id === account.id ? own : null
    const values = { name: text(account.name), address: text(account.address), deleted: account.deleted }
    // Agent and type (Linko's account has neither): its own shop's, given when the account is new.
    if (!(await client.query("SELECT 1 FROM financial_accounts WHERE id = $1", [account.id])).rowCount) {
      values.agent = fullName(ownShop?.responsible_agent)
      values.type = text(ownShop?.market_type?.name)
    }
    if (account.created_date) values.created_at = sqlDateTime(account.created_date)
    stats.accounts[await upsertById(client, run, "financial_accounts", account.id, values)]++
  }
  for (const market of markets) {
    const accountId = market.client?.id
    if (!accountId) continue
    const current = (await client.query("SELECT financial_account_id FROM financial_account_markets WHERE client_id = $1", [market.id])).rows[0]
    if (!current) {
      await client.query("INSERT INTO financial_account_markets (client_id, financial_account_id) VALUES ($1, $2)", [market.id, accountId])
      await register(client, run, "financial_account_markets", market.id, "insert")
      stats.links.insert++
    } else if (Number(current.financial_account_id) !== accountId) {
      await client.query("UPDATE financial_account_markets SET financial_account_id = $2 WHERE client_id = $1", [market.id, accountId])
      await register(client, run, "financial_account_markets", market.id, "update", current)
      stats.links.update++
    } else stats.links.same++
  }

  // --- Ограничения -------------------------------------------------------------------------------------------------
  for (const restriction of [...(marketRestrictions ?? [])].sort((a, b) => a.id - b.id)) {
    const row = (await client.query("SELECT config FROM client_restrictions WHERE id = $1", [restriction.id])).rows[0]
    let config = {}
    try {
      const parsed = JSON.parse(row?.config || "{}")
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed
    } catch {
      // a config that is not JSON is replaced by Linko's fields
    }
    const subject = RESTRICTION_SUBJECTS[restriction.type] ?? text(restriction.type)
    const next = { ...config, ...(subject ? { type: subject } : {}), minQty: Boolean(restriction.for_min_amount) }
    stats.restrictions[await upsertById(client, run, "client_restrictions", restriction.id, { name: text(restriction.name) || `#${restriction.id}`, config: JSON.stringify(next) })]++
  }

  for (const table of ["clients", "client_types", "store_categories", "client_attributes", "client_attribute_values", "client_restrictions"]) await bumpSequence(client, table)
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
const source = drawer ? `with the shops' details of ${drawer.source}` : "without the shops' details (no shop_drawer.json: phones, notes, «Создал» stay as they are)"
console.log(`base clients: ${markets.length} shops, ${accounts.length} accounts in Linko, ${source} →`, JSON.stringify(stats))
