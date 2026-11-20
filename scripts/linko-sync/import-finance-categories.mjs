// Финансы → Категории приходов / Категории расходов: Linko's rows (finance/income_category/,
// finance/expense_category/) by id. Per row: the name, the option («Параметры»: Linko's option key, stored the way the
// app's dialog saves it — the app's title of that option in `parameter`, its keys in `options`, so the app's own option
// names such as «Карта клиента» stay), «Прочий приход» (is_other), «Род. категория» (parent), «Внутренний расход»
// (internal_transfer → direct), «Не учитывать в отчёте P&L» (disable_pl → exclude_from_pnl) and the creation time.
// Only the columns that differ are written, each change registered with the previous values; a Linko row missing here
// is added under its id; local rows Linko does not have (the app's «Приход от сотрудников») are left alone. A rename is
// copied to the money rows that keep the category name as text, like the categories pages do.
//
//   node scripts/linko-sync/import-finance-categories.mjs   (raw: income_categories, expense_categories; RAW=<folder>)
//   DRY=1 node scripts/linko-sync/import-finance-categories.mjs   lists the changes and rolls back
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const DRY = process.env.DRY === "1"
const run = runId("finance-categories")

// Linko option key → the app's option key (lib/cash/types.ts CATEGORY_OPTIONS) and the title the app stores in
// `parameter` (the same labels cash_param_options() of lib/cash/schema.ts reads back).
const OPTION_KEYS = { supply_expanse: "supply_expense" }
const OPTION_TITLES = {
  client: "Клиент",
  client_card_out: "Карта клиента",
  client_contract: "Выдача денег для Кэшбек",
  provider: "Поставщик",
  supply: "Поставка",
  order: "Заказ",
  supply_expense: "Доп. расход",
  staff_expense: "Расход на сотрудников",
  staff_income: "Приход от сотрудников",
  transaction_child: "Детализация",
  amortization: "Амортизация",
}
// "Поставка" also lets the operation pick the supplier (cash_param_options: ["supply","provider"]).
const optionKeys = (key) => (key === "supply" ? ["supply", "provider"] : [key])

/** Linko options → { parameter, options } as the app saves them; null when Linko has an option the app does not know. */
function optionColumns(linkoOptions) {
  const keys = (linkoOptions ?? []).map((option) => OPTION_KEYS[option.key_name] ?? option.key_name)
  if (keys.some((key) => !OPTION_TITLES[key])) return null
  const options = [...new Set(keys.flatMap(optionKeys))]
  return { parameter: keys.length ? OPTION_TITLES[keys[0]] : "", options: JSON.stringify(options) }
}

/** Linko "2025-03-06T13:41:53.660694" → the app's "2025-03-06 13:41:53". */
const createdAt = (value) => String(value ?? "").slice(0, 19).replace("T", " ")
const sameOptions = (a, b) => {
  try {
    return JSON.stringify(JSON.parse(a ?? "[]")) === JSON.stringify(JSON.parse(b ?? "[]"))
  } catch {
    return false
  }
}

// Money rows that keep a category's name as text next to its id (lib/categories-common.ts renames them the same way).
const RENAME_TARGETS = {
  income_categories: [
    ["cash_management_entries", "category", "income_category_id"],
    ["customer_payments", "income_category", "income_category_id"],
    ["supplier_payments", "category", "income_category_id"],
  ],
  expense_categories: [
    ["cash_management_entries", "category", "expense_category_id"],
    ["supplier_payments", "category", "expense_category_id"],
  ],
}

const stats = { inserted: 0, updated: 0, renamedRows: 0, skipped: [] }
const changes = []
const client = await connect()
await ensureRegistry(client)

async function columnExists(table, column) {
  const { rows } = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2", [table, column])
  return rows.length > 0
}

async function renameMoneyRows(table, id, name) {
  for (const [moneyTable, textColumn, idColumn] of RENAME_TARGETS[table]) {
    if (!(await columnExists(moneyTable, textColumn)) || !(await columnExists(moneyTable, idColumn))) continue
    const { rows } = await client.query(`SELECT id, ${textColumn} AS value FROM ${moneyTable} WHERE ${idColumn} = $1 AND ${textColumn} IS DISTINCT FROM $2`, [id, name])
    for (const row of rows) {
      await client.query(`UPDATE ${moneyTable} SET ${textColumn} = $1 WHERE id = $2`, [name, row.id])
      await register(client, run, moneyTable, row.id, "update", { [textColumn]: row.value })
      stats.renamedRows++
    }
  }
}

/** Writes one Linko category: `wanted` = the app's columns; only differing ones are updated. */
async function syncRow(table, id, wanted) {
  const before = (await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0]
  if (!before) {
    const columns = Object.keys(wanted)
    await client.query(
      `INSERT INTO ${table} (id, ${columns.join(", ")}, updated_at) VALUES ($1, ${columns.map((_, index) => `$${index + 2}`).join(", ")}, datetime('now'))`,
      [id, ...columns.map((column) => wanted[column])],
    )
    await register(client, run, table, id, "insert")
    changes.push(`${table} ${id} «${wanted.name}»: added`)
    stats.inserted++
    return
  }
  const diff = {}
  for (const [column, value] of Object.entries(wanted)) {
    const same = column === "options" ? sameOptions(before.options, value) : column === "created_at" ? createdAt(before.created_at) === value : String(before[column] ?? "") === String(value ?? "")
    if (!same) diff[column] = value
  }
  if (!Object.keys(diff).length) return
  const columns = Object.keys(diff)
  await client.query(`UPDATE ${table} SET ${columns.map((column, index) => `${column} = $${index + 2}`).join(", ")} WHERE id = $1`, [id, ...columns.map((column) => diff[column])])
  await register(client, run, table, id, "update", Object.fromEntries(columns.map((column) => [column, before[column]])))
  if (diff.name !== undefined) await renameMoneyRows(table, id, diff.name)
  changes.push(`${table} ${id} «${before.name}»: ${columns.map((column) => `${column} ${JSON.stringify(before[column])} → ${JSON.stringify(diff[column])}`).join(", ")}`)
  stats.updated++
}

try {
  await client.query("BEGIN")
  // The columns lib/categories-common.ts adds.
  await client.query("ALTER TABLE income_categories ADD COLUMN IF NOT EXISTS options TEXT; ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS options TEXT;")

  for (const category of raw("income_categories")) {
    const option = optionColumns(category.options)
    if (!option) {
      stats.skipped.push(`income ${category.id} (unknown option ${JSON.stringify(category.options)})`)
      continue
    }
    await syncRow("income_categories", Number(category.id), {
      name: String(category.name ?? "").trim(),
      parameter: option.parameter,
      options: option.options,
      other_income: category.is_other ? 1 : 0,
      created_at: createdAt(category.created_date),
    })
  }

  // Parents first, so a new child can point at a parent added in the same run.
  const expense = raw("expense_categories").slice().sort((a, b) => Number(Boolean(a.parent)) - Number(Boolean(b.parent)) || a.id - b.id)
  for (const category of expense) {
    const option = optionColumns(category.options)
    if (!option) {
      stats.skipped.push(`expense ${category.id} (unknown option ${JSON.stringify(category.options)})`)
      continue
    }
    await syncRow("expense_categories", Number(category.id), {
      name: String(category.name ?? "").trim(),
      parameter: option.parameter,
      options: option.options,
      parent_id: category.parent?.id ?? null,
      direct: category.internal_transfer ? 1 : 0,
      exclude_from_pnl: category.disable_pl ? 1 : 0,
      created_at: createdAt(category.created_date),
    })
  }

  for (const table of ["income_categories", "expense_categories"]) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT MAX(id) FROM ${table}), 1))`)
  }
  await client.query(DRY ? "ROLLBACK" : "COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
for (const line of changes) console.log(line)
console.log(
  `finance categories${DRY ? " (DRY, rolled back)" : ""}: ${stats.inserted} added, ${stats.updated} updated, ${stats.renamedRows} money rows renamed` +
    (stats.skipped.length ? `; skipped: ${stats.skipped.join(", ")}` : ""),
)
