// One-off: the data side of the user's changes of 2026-11-04, for databases created before them.
//  - Валюты: SUM → SOM, Euro → ЕВРО (USD stays). Only the name changes: the codes (SUM, EUR) that every money
//    table stores stay as they are, and both spellings are aliases of the finance core (fin_cur,
//    lib/finance/currency.ts). A currency the user already renamed to anything else is left alone.
//  - Категории расходов: a `parameter` still holding the raw option key client_card_out (imported from the
//    demo) gets the Russian title the pages now write, "Карта клиента" (its `options` are unchanged).
//  - Категории приходов: the category "Приход от сотрудников" with the option of the same name (staff_income:
//    the Приход dialog then asks for the employees who bring the money), unless a category of that name exists.
//    Same columns as lib/income-categories-repo.ts createIncomeCategory writes.
// Running it again changes nothing.
//
//   node scripts/apply-currency-category-names.mjs          (reads DATABASE_URL from the environment, else from .env)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = path.join(root, ".env")
  const match = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.*)$/m) : null
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

const RENAMES = [
  { code: "SUM", from: ["SUM", "Sum", "sum", "UZS"], to: "SOM" },
  { code: "EUR", from: ["Euro", "EURO", "EUR", "euro"], to: "ЕВРО" },
]

const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN")
  for (const rename of RENAMES) {
    const result = await client.query(
      `UPDATE currencies SET name = $1, updated_at = datetime('now')
        WHERE upper(btrim(code)) = $2 AND btrim(name) = ANY($3::text[])
        RETURNING id, code`,
      [rename.to, rename.code, rename.from],
    )
    for (const row of result.rows) console.log(`currencies #${row.id} (${row.code}) → ${rename.to}`)
  }
  const categories = await client.query(
    `UPDATE expense_categories SET parameter = 'Карта клиента', updated_at = datetime('now')
      WHERE lower(btrim(parameter)) = 'client_card_out'
      RETURNING id, name`,
  )
  for (const row of categories.rows) console.log(`expense_categories #${row.id} (${row.name}): client_card_out → Карта клиента`)
  // Serialised like the categories pages (lib/categories-common.ts lockCategories) and matched by the same name key.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('linko:income_categories'))")
  const staffIncome = await client.query(
    `INSERT INTO income_categories (name, parameter, other_income, options)
     SELECT 'Приход от сотрудников', 'Приход от сотрудников', 0, '["staff_income"]'
      WHERE NOT EXISTS (SELECT 1 FROM income_categories WHERE lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) = 'приход от сотрудников')
     RETURNING id`,
  )
  for (const row of staffIncome.rows) console.log(`income_categories #${row.id}: Приход от сотрудников (staff_income) added`)
  await client.query("COMMIT")
  const { rows } = await client.query("SELECT id, name, code, is_base FROM currencies ORDER BY is_base DESC, id")
  console.table(rows)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
