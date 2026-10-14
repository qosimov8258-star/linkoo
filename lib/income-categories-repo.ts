import "server-only"

import type { IncomeCategory, IncomeCategoryListResult } from "@/components/analytics/income-categories-data"
import {
  assertNameAvailable,
  cascadeCategoryRename,
  categoryNameKey,
  CategoryError,
  categoryOrderBy,
  categoryUsage,
  ensureCategorySchema,
  keySql,
  localCreatedDate,
  lockCategories,
  nameCollation,
  optionColumns,
} from "@/lib/categories-common"
import type { CategoryListQuery, CategoryUsage, IncomeCategoryInput } from "@/lib/categories-schema"
import { storedCategoryOptions } from "@/lib/category-options"
import { getDb, withTransaction, type PgDb } from "@/lib/db"

// "Категории приходов" (demo finance/income_category). income_categories(id, name,
// parameter, other_income, options, created_at, updated_at) — read directly by the cash
// core (lib/cash/common.ts loadCategories), so the columns keep their meaning. See
// lib/categories-common.ts for the shared rules (unique names, options + parameter,
// rename copied to the money rows, delete refused while referenced).

export type { IncomeCategoryInput } from "@/lib/categories-schema"

type Row = { id: number; name: string; parameter: string | null; other_income: number; options: string | null; created_at: string | null }

const COLUMNS = "c.id, c.name, c.parameter, c.other_income, c.options, c.created_at"

function rowToCategory(row: Row): IncomeCategory {
  return {
    id: Number(row.id),
    name: row.name,
    parameter: row.parameter ?? "",
    options: storedCategoryOptions(row.options, row.parameter),
    otherIncome: Number(row.other_income) === 1,
    createdDate: localCreatedDate(row.created_at),
  }
}

async function readRow(db: PgDb, id: number, lock = false): Promise<Row | undefined> {
  return (await db.prepare(`SELECT ${COLUMNS} FROM income_categories c WHERE c.id = ?${lock ? " FOR UPDATE" : ""}`).get(id)) as Row | undefined
}

const searchWhere = `WHERE (@needle = '' OR strpos(${keySql("c.name")}, @needle) > 0)`

/** Plain array for the selects of other pages (unchanged contract: id DESC); ?ordering=name sorts by name. */
export async function listIncomeCategories(search = "", ordering = ""): Promise<IncomeCategory[]> {
  await ensureCategorySchema()
  const db = getDb()
  const orderBy = ordering ? categoryOrderBy(ordering, await nameCollation(db)) : "c.id DESC"
  const rows = (await db
    .prepare(`SELECT ${COLUMNS} FROM income_categories c ${searchWhere} ORDER BY ${orderBy}`)
    .all({ needle: categoryNameKey(search) })) as Row[]
  return rows.map(rowToCategory)
}

/** The grid (demo GET finance/income_category/?search&page&page_size&ordering; default order = name). */
export async function listIncomeCategoriesPage(query: CategoryListQuery): Promise<IncomeCategoryListResult> {
  await ensureCategorySchema()
  const db = getDb()
  const needle = categoryNameKey(query.search)
  const pageSize = query.pageSize ?? 25
  const page = query.page ?? 1
  const orderBy = categoryOrderBy(query.ordering, await nameCollation(db))
  const countRow = await db.prepare(`SELECT COUNT(*) AS n FROM income_categories c ${searchWhere}`).get({ needle })
  const rows = (await db
    .prepare(`SELECT ${COLUMNS} FROM income_categories c ${searchWhere} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
    .all({ needle, limit: pageSize, offset: (page - 1) * pageSize })) as Row[]
  return { count: Number(countRow?.n ?? 0), results: rows.map(rowToCategory) }
}

export async function getIncomeCategory(id: number): Promise<IncomeCategory | null> {
  await ensureCategorySchema()
  const row = await readRow(getDb(), id)
  return row ? rowToCategory(row) : null
}

/** Demo GET finance/income_category/:id/; `withUsage` adds where the category is referenced. */
export async function getIncomeCategoryDetail(id: number, withUsage = false): Promise<(IncomeCategory & { usage?: CategoryUsage[] }) | null> {
  await ensureCategorySchema()
  const db = getDb()
  const row = await readRow(db, id)
  if (!row) return null
  return withUsage ? { ...rowToCategory(row), usage: await categoryUsage(db, "income", row) } : rowToCategory(row)
}

/** Writes `options` exactly (a second statement, so the options trigger never re-derives them). */
async function writeOptions(db: PgDb, id: number, options: string) {
  await db.prepare("UPDATE income_categories SET options = @options WHERE id = @id AND options IS DISTINCT FROM @options").run({ id, options })
}

export async function createIncomeCategory(input: IncomeCategoryInput): Promise<IncomeCategory> {
  await ensureCategorySchema()
  return withTransaction(async (tx) => {
    await lockCategories(tx, "income")
    await assertNameAvailable(tx, "income", input.name, null)
    const { options, parameter } = optionColumns(input.option)
    const result = await tx
      .prepare("INSERT INTO income_categories (name, parameter, other_income, options) VALUES (@name, @parameter, @otherIncome, @options)")
      .run({ name: input.name, parameter, otherIncome: input.otherIncome ? 1 : 0, options })
    const id = Number(result.lastInsertRowid)
    await writeOptions(tx, id, options)
    return rowToCategory((await readRow(tx, id))!)
  })
}

/** Demo PUT finance/income_category/:id. A rename is copied to the money rows linked by id. */
export async function updateIncomeCategory(id: number, input: IncomeCategoryInput): Promise<IncomeCategory | null> {
  await ensureCategorySchema()
  return withTransaction(async (tx) => {
    await lockCategories(tx, "income")
    const current = await readRow(tx, id, true)
    if (!current) return null
    if (current.name !== input.name) {
      await assertNameAvailable(tx, "income", input.name, id)
      await cascadeCategoryRename(tx, "income", id, input.name)
    }
    const { options, parameter } = optionColumns(input.option)
    await tx
      .prepare(
        `UPDATE income_categories SET name = @name, parameter = @parameter, other_income = @otherIncome, options = @options,
           updated_at = datetime('now') WHERE id = @id`,
      )
      .run({ id, name: input.name, parameter, otherIncome: input.otherIncome ? 1 : 0, options })
    await writeOptions(tx, id, options)
    return rowToCategory((await readRow(tx, id))!)
  })
}

/** Demo DELETE finance/income_category/:id — refused (409) while money rows reference it. */
export async function deleteIncomeCategory(id: number): Promise<boolean> {
  await ensureCategorySchema()
  return withTransaction(async (tx) => {
    await lockCategories(tx, "income")
    const current = await readRow(tx, id, true)
    if (!current) return false
    const usage = await categoryUsage(tx, "income", current)
    if (usage.length) throw new CategoryError("Удаление невозможно из-за связи с другими данными", 409, undefined, usage)
    const result = await tx.prepare("DELETE FROM income_categories WHERE id = ?").run(id)
    return result.changes > 0
  })
}
