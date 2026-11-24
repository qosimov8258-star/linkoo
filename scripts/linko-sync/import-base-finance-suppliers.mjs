// Base rows of Финансы and Склад → Поставщики that no other step creates (a new account's copy starts without them),
// under Linko's ids, so the later steps find them (import-finance-cash, import-cash-list-facts: cashboxes by id;
// import-supplies, import-stock-docs, import-finance-suppliers, import-supplier-details: suppliers by id;
// import-field-records: refusal types by name; import-settings-lists: the subscribers of the notification templates by
// template id):
//   finance/cashbox/                    → cashboxes: name, currency code, cashier («First Last», and cashier_id when
//                                          that employee is in the copy), branch name, «наличный» / «банковский счет»,
//                                          «Ван селл», position («Порядковый номер»: none → 0), creation moment
//   stock/provider_category/            → supplier_categories
//   stock/provider/ + each card         → suppliers: category, branch and organization by name («Не указано» when
//     (providers_detail)                   none), address, «Контакты» and «Добавить запас» in the shape of
//                                          import-supplier-details.mjs, «Дата добавления», the card's modified_date
//   saas/template/ (docs_templates)     → doc_templates (Шаблоны документов): html, key, «Активный», Linko's order
//   notification/notification_template/ → notification_templates: title, text, keywords, on / off (who receives them:
//                                          import-settings-lists.mjs)
//   market/rejection_type/              → refusal_types (Типы отказов): name, «Решение», creation moment
// Other steps copy the rest of these pages: the currencies, branches, organizations and employees the cashboxes and
// suppliers name (import-base-org-people.mjs, run before this step), income / expense categories
// (import-finance-categories.mjs adds the missing ones), the currency rate history and individual rates
// (import-finance-contracts.mjs), report templates (import-report-details.mjs).
//
// A missing row is inserted under Linko's id; an existing one gets the columns that differ, each change registered in
// linko_sync_rows with the previous values, so a second run changes nothing. A stored currency, cashier, branch or
// cash / bank label that means the same as Linko's is kept as written. Rows of the app that Linko does not have are
// left alone and listed. Before writing, the app's own code creates the tables it makes on first use
// (ensure-base-finance-suppliers.ts; skipped with DRY=1, which then only reports what the existing tables would get).
// On the first account's copy a run only fills cashboxes.cashier_id (the older copy has none); every other row of
// these tables already equals Linko's.
//
//   node scripts/linko-sync/import-base-finance-suppliers.mjs
//   raw: cashboxes, provider_categories, providers, providers_detail, docs_templates (else saas_templates),
//        notification_templates, rejection_types, branches, divisions; a list missing from the raw folder skips its table
//   DRY=1 node scripts/linko-sync/import-base-finance-suppliers.mjs   lists the changes and rolls back
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ROOT, bumpSequence, connect, currencyCode, ensureRegistry, fullName, hasRaw, raw, runId, ruShortDate, sqlDateTime, tableExists, upsertById } from "./lib.mjs"
import { localIso, text } from "./finance-lib.mjs"

const DRY = process.env.DRY === "1"
const here = path.dirname(fileURLToPath(import.meta.url))
const run = runId("base-finance-suppliers")

/** The tables of this step that the app creates on first use, made by the app's own code (a tsx step). */
function ensureAppSchema() {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "--conditions=react-server", "--tsconfig", path.join(ROOT, "tsconfig.json"), path.join(here, "ensure-base-finance-suppliers.ts")],
    { stdio: "inherit", env: process.env, cwd: here },
  )
  if (result.status !== 0) throw new Error(`ensure-base-finance-suppliers.ts failed (${result.error?.message ?? `exit ${result.status}`})`)
}

/** fin_key() / cashboxNameKey(): lower case, trimmed, whitespace (no-break spaces included) collapsed. */
const nameKey = (value) =>
  String(value ?? "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

/** The cashbox type a stored payment_type label means (components/analytics/cashboxes-data.ts cashboxTypeOf). */
function cashboxTypeOf(value) {
  const key = nameKey(value)
  if (/^(нал|cash|naq|nagt)/.test(key)) return "cash"
  if (/^(банк|bank|card|карт|переч|o'tkaz|otkaz|transfer)/.test(key)) return "bank"
  return null
}
// The labels the app's cashbox dialog stores (CASHBOX_TYPE_LABELS).
const CASHBOX_TYPE_LABELS = { cash: "наличный", bank: "банковский счет" }

/** A Linko reference (an object with a name, or a bare id) → its name; `names`: id → name of the raw list. */
function refName(value, names) {
  if (value == null || value === "") return ""
  if (typeof value === "object") return text(value.name) || text(names.get(Number(value.id)))
  return text(names.get(Number(value)))
}
const namesOf = (list) => new Map((hasRaw(list) ? raw(list) : []).map((row) => [Number(row.id), row.name]))

// The supplier card's «Контакты» and «Добавить запас», exactly as import-supplier-details.mjs writes them (its strings
// untrimmed), so that step finds them equal.
const asText = (value) => (value == null ? "" : String(value))
const contactsOf = (doc) => (doc.contacts ?? []).map((contact) => ({ id: Number(contact.id), name: asText(contact.name), email: asText(contact.email), phone: asText(contact.phone) }))
const productsOf = (doc) =>
  (doc.reserve_products ?? []).map((line) => ({
    id: Number(line.id),
    productId: line.product?.id == null ? null : Number(line.product.id),
    product: asText(line.product?.name),
    unit: asText(line.product?.measurement?.name),
    qty: Number(line.amount) || 0,
    price: Number(line.cost) || 0,
    currency: asText(line.currency?.name) || "SUM",
    manual: Boolean(line.manual_cost),
  }))

const stats = {}
const notes = []
const count = (table, action) => {
  stats[table] ??= { insert: 0, update: 0, same: 0, skipped: 0 }
  stats[table][action]++
}

const client = await connect()
await ensureRegistry(client)

/** upsertById inside a savepoint: a row that breaks a unique rule (a name or code another row already has) is skipped
 * and reported instead of failing the run. */
async function put(table, id, values, label) {
  await client.query("SAVEPOINT base_row")
  try {
    const action = await upsertById(client, run, table, id, values)
    await client.query("RELEASE SAVEPOINT base_row")
    count(table, action)
    if (DRY && action !== "same") notes.push(`${table} ${id} «${label}»: ${action}`)
  } catch (error) {
    if (error?.code !== "23505") throw error
    await client.query("ROLLBACK TO SAVEPOINT base_row")
    count(table, "skipped")
    notes.push(`${table} ${id} «${label}» skipped: ${error.detail ?? error.message}`)
  }
}

/** The raw list of a section, or null (the section is skipped) when the raw folder or the database lacks it. */
async function source(table, ...lists) {
  const list = lists.find((name) => hasRaw(name))
  if (!list) {
    notes.push(`${table}: skipped, none of ${lists.join(" / ")} in the raw folder`)
    return null
  }
  if (!(await tableExists(client, table))) {
    notes.push(`${table}: skipped, the table does not exist yet (DRY; a real run lets the app create it)`)
    return null
  }
  return raw(list)
}

/** Ids of `table` that Linko does not have (left alone), for the summary. */
async function localOnly(table, linkoIds) {
  const keep = new Set([...linkoIds].map(Number))
  const ids = (await client.query(`SELECT id FROM ${table} ORDER BY id`)).rows.map((row) => Number(row.id)).filter((id) => !keep.has(id))
  if (ids.length) notes.push(`${table}: rows Linko does not have, left alone: ${ids.join(", ")}`)
}

try {
  if (!DRY) ensureAppSchema()
  await client.query("BEGIN")

  // --- cashboxes -------------------------------------------------------------------------------------------------------
  const cashboxes = await source("cashboxes", "cashboxes")
  if (cashboxes) {
    const branches = namesOf("branches")
    const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
    const local = new Map((await client.query("SELECT id, currency, cashier, cashier_id, branch, payment_type FROM cashboxes")).rows.map((row) => [Number(row.id), row]))
    // The currencies and branches the cashboxes name come from import-base-org-people.mjs: a missing one is reported.
    const codes = new Set((await client.query("SELECT code FROM currencies")).rows.map((row) => currencyCode({ name: row.code })))
    const branchNames = new Set((await client.query("SELECT name FROM branches")).rows.map((row) => nameKey(row.name)))
    const noEmployee = new Set()
    const unknown = new Set()
    for (const cashbox of cashboxes) {
      const id = Number(cashbox.id)
      const current = local.get(id)
      const type = cashbox.type === "bank" ? "bank" : "cash"
      const cashier = fullName(cashbox.cashier)
      const cashierId = Number(cashbox.cashier?.id ?? cashbox.cashier) || null
      const branch = refName(cashbox.branch, branches)
      if (cashierId && !employees.has(cashierId)) noEmployee.add(cashierId)
      if (!codes.has(currencyCode(cashbox.currency))) unknown.add(`currency ${currencyCode(cashbox.currency)}`)
      if (branch && !branchNames.has(nameKey(branch))) unknown.add(`branch «${branch}»`)
      await put(
        "cashboxes",
        id,
        {
          name: text(cashbox.name),
          currency: current && currencyCode(current.currency) === currencyCode(cashbox.currency) ? current.currency : currencyCode(cashbox.currency),
          cashier: current && nameKey(current.cashier) === nameKey(cashier) ? current.cashier : cashier,
          // The employee card behind the cashier (the cash core falls back to the name while the employee is not here).
          cashier_id: cashierId && employees.has(cashierId) ? cashierId : null,
          branch: current && nameKey(current.branch) === nameKey(branch) ? current.branch : branch,
          payment_type: current && cashboxTypeOf(current.payment_type) === type ? current.payment_type : CASHBOX_TYPE_LABELS[type],
          vansell: cashbox.is_van_sell ? 1 : 0,
          order_number: Number(cashbox.position) || 0,
          ...(sqlDateTime(cashbox.created_date) ? { created_at: sqlDateTime(cashbox.created_date) } : {}),
        },
        cashbox.name,
      )
    }
    if (noEmployee.size) notes.push(`cashboxes: cashier employee(s) ${[...noEmployee].join(", ")} not in the copy yet: cashier_id left empty (a run after the employees fills it)`)
    if (unknown.size) notes.push(`cashboxes: ${[...unknown].join(", ")} not in the copy yet (import-base-org-people.mjs writes them)`)
    await localOnly("cashboxes", cashboxes.map((cashbox) => cashbox.id))
    await bumpSequence(client, "cashboxes")
  }

  // --- supplier categories and suppliers -------------------------------------------------------------------------------
  const categories = await source("supplier_categories", "provider_categories")
  if (categories) {
    for (const category of categories) await put("supplier_categories", Number(category.id), { name: text(category.name) }, category.name)
    await localOnly("supplier_categories", categories.map((category) => category.id))
    await bumpSequence(client, "supplier_categories")
  }
  const providers = await source("suppliers", "providers")
  if (providers) {
    const categoryNames = namesOf("provider_categories")
    const branches = namesOf("branches")
    const divisions = namesOf("divisions")
    const details = hasRaw("providers_detail") ? raw("providers_detail") : {}
    if (!hasRaw("providers_detail")) notes.push("suppliers: providers_detail not in the raw folder, contacts and reserve left as they are")
    for (const listed of providers) {
      const id = Number(listed.id)
      const detail = details[id] && !details[id].__status ? details[id] : null
      const provider = detail ? { ...listed, ...detail } : listed
      const created = sqlDateTime(provider.created_date)
      await put(
        "suppliers",
        id,
        {
          name: text(provider.name),
          category: refName(provider.category, categoryNames),
          created_date: ruShortDate(provider.created_date),
          address: text(provider.address),
          branch: refName(provider.branch, branches) || "Не указано",
          organization: refName(provider.division, divisions) || "Не указано",
          ...(detail ? { contacts: JSON.stringify(contactsOf(detail)), products: JSON.stringify(productsOf(detail)) } : {}),
          ...(created ? { created_at: created, updated_at: sqlDateTime(provider.modified_date) ?? created } : {}),
        },
        provider.name,
      )
    }
    await localOnly("suppliers", providers.map((provider) => provider.id))
    await bumpSequence(client, "suppliers")
  }

  // --- document templates ----------------------------------------------------------------------------------------------
  const templates = await source("doc_templates", "docs_templates", "saas_templates")
  if (templates) {
    const kept = templates.filter((template) => !template.is_delete)
    if (kept.length < templates.length) notes.push(`doc_templates: ${templates.length - kept.length} deleted template(s) of Linko not copied`)
    for (const [index, template] of kept.entries()) {
      await put(
        "doc_templates",
        Number(template.id),
        {
          name: text(template.name),
          html: String(template.html ?? ""),
          key_name: text(template.key_name) || "order",
          is_active: template.is_active ? 1 : 0,
          created_date: localIso(template.created_date),
          modified_date: localIso(template.modified_date ?? template.created_date),
          // The list's order before a header is sorted: Linko's.
          position: index + 1,
        },
        template.name,
      )
    }
    await localOnly("doc_templates", kept.map((template) => template.id))
    await bumpSequence(client, "doc_templates")
  }

  // --- notification templates ------------------------------------------------------------------------------------------
  const notifications = await source("notification_templates", "notification_templates")
  if (notifications) {
    for (const template of notifications) {
      await put(
        "notification_templates",
        Number(template.id),
        {
          name: text(template.name),
          title: String(template.title ?? ""),
          text: String(template.text ?? ""),
          keywords: String(template.keywords ?? ""),
          status: template.status === "off" ? "off" : "on",
        },
        template.name,
      )
    }
    await localOnly("notification_templates", notifications.map((template) => template.id))
    await bumpSequence(client, "notification_templates")
  }

  // --- refusal types ---------------------------------------------------------------------------------------------------
  const refusals = await source("refusal_types", "rejection_types")
  if (refusals) {
    for (const refusal of refusals) {
      const created = sqlDateTime(refusal.created_date)
      await put("refusal_types", Number(refusal.id), { name: text(refusal.name), resolution: text(refusal.solution), ...(created ? { created_at: created } : {}) }, refusal.name)
    }
    await localOnly("refusal_types", refusals.map((refusal) => refusal.id))
    await bumpSequence(client, "refusal_types")
  }

  await client.query(DRY ? "ROLLBACK" : "COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}

for (const line of notes) console.log(line)
console.log(`base finance / suppliers${DRY ? " (DRY, rolled back)" : ""}:`)
for (const [table, s] of Object.entries(stats)) console.log(`  ${table.padEnd(24)} insert ${s.insert}, update ${s.update}, unchanged ${s.same}, skipped ${s.skipped}`)
