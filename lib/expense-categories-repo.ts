import "server-only"

import type { ExpenseCategory, ExpenseCategoryListResult } from "@/components/analytics/expense-categories-data"
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
import type { CategoryListQuery, CategoryUsage, ExpenseCategoryInput } from "@/lib/categories-schema"
import { storedCategoryOptions } from "@/lib/category-options"
import { getDb, withTransaction, type PgDb } from "@/lib/db"

// "Категории расходов" (demo finance/expense_category). expense_categories(id, name,
// parameter, parent_id, direct, exclude_from_pnl, options, created_at, updated_at) — read
// directly by the cash core (direct = demo internal_transfer "Внутренний расход",
// exclude_from_pnl = demo disable_pl), so the columns keep their meaning. Rules shared
// with the income categories: lib/categories-common.ts. Specific to expenses:
//   * the parent must exist and may not be the category itself or one of its
//     descendants (no cycles);
//   * a direct expense is never excluded from P&L (the dialog hides that checkbox);
//   * a category with children cannot be deleted (it used to delete the children).

export type { ExpenseCategoryInput } from "@/lib/categories-schema"

type Row = {
  id: number
  name: string
  parameter: string | null
  parent_id: number | null
  parent_name: string | null
  direct: number
  exclude_from_pnl: number
  options: string | null
  created_at: string | null
}

const SELECT = `SELECT c.id, c.name, c.parameter, c.parent_id, p.name AS parent_name, c.direct, c.exclude_from_pnl, c.options, c.created_at
  FROM expense_categories c LEFT JOIN expense_categories p ON p.id = c.parent_id`

function rowToCategory(row: Row): ExpenseCategory {
  return {
    id: Number(row.id),
    name: row.name,
    parameter: row.parameter ?? "",
    options: storedCategoryOptions(row.options, row.parameter),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    parentName: row.parent_name ?? "",
    direct: Number(row.direct) === 1,
    excludeFromPnl: Number(row.exclude_from_pnl) === 1,
    createdDate: localCreatedDate(row.created_at),
  }
}

async function readRow(db: PgDb, id: number, lock = false): Promise<Row | undefined> {
  return (await db.prepare(`${SELECT} WHERE c.id = ?${lock ? " FOR UPDATE OF c" : ""}`).get(id)) as Row | undefined
}

const searchWhere = `WHERE (@needle = '' OR strpos(${keySql("c.name")}, @needle) > 0)`

/** "Внутренний расход" header (by direct, then name). */
async function orderBy(db: PgDb, ordering: string | undefined): Promise<string> {
  const collation = await nameCollation(db)
  const name = `lower(c.name) COLLATE ${collation}`
  return categoryOrderBy(ordering, collation, {
    direct: `c.direct ASC, ${name} ASC, c.id ASC`,
    "-direct": `c.direct DESC, ${name} ASC, c.id ASC`,
  })
}

/** Plain array for the selects of other pages (unchanged contract: id DESC); ?ordering=name sorts by name. */
export async function listExpenseCategories(search = "", ordering = ""): Promise<ExpenseCategory[]> {
  await ensureCategorySchema()
  const db = getDb()
  const order = ordering ? await orderBy(db, ordering) : "c.id DESC"
  const rows = (await db.prepare(`${SELECT} ${searchWhere} ORDER BY ${order}`).all({ needle: categoryNameKey(search) })) as Row[]
  return rows.map(rowToCategory)
}

/** The grid (demo GET finance/expense_category/?search&page&page_size&ordering; default order = name). */
export async function listExpenseCategoriesPage(query: CategoryListQuery): Promise<ExpenseCategoryListResult> {
  await ensureCategorySchema()
  const db = getDb()
  const needle = categoryNameKey(query.search)
  const pageSize = query.pageSize ?? 25
  const page = query.page ?? 1
  const order = await orderBy(db, query.ordering)
  const countRow = await db.prepare(`SELECT COUNT(*) AS n FROM expense_categories c ${searchWhere}`).get({ needle })
  const rows = (await db
    .prepare(`${SELECT} ${searchWhere} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ needle, limit: pageSize, offset: (page - 1) * pageSize })) as Row[]
  return { count: Number(countRow?.n ?? 0), results: rows.map(rowToCategory) }
}

export async function getExpenseCategory(id: number): Promise<ExpenseCategory | null> {
  await ensureCategorySchema()
  const row = await readRow(getDb(), id)
  return row ? rowToCategory(row) : null
}

/** Demo GET finance/expense_category/:id/; `withUsage` adds where the category is referenced. */
export async function getExpenseCategoryDetail(id: number, withUsage = false): Promise<(ExpenseCategory & { usage?: CategoryUsage[] }) | null> {
  await ensureCategorySchema()
  const db = getDb()
  const row = await readRow(db, id)
  if (!row) return null
  return withUsage ? { ...rowToCategory(row), usage: await categoryUsage(db, "expense", row) } : rowToCategory(row)
}

/** The parent must exist and must not be `id` itself or one of its descendants. */
async function assertParent(db: PgDb, id: number | null, parentId: number | null) {
  if (parentId === null) return
  if (id !== null && parentId === id) throw new CategoryError("Категория не может быть родительской для самой себя", 400, "parentId")
  const parent = await db.prepare("SELECT id FROM expense_categories WHERE id = ?").get(parentId)
  if (!parent) throw new CategoryError("Родительская категория не найдена", 400, "parentId")
  if (id === null) return
  // Walk up from the chosen parent: meeting `id` means the parent is one of its descendants.
  const cycle = await db
    .prepare(
      `WITH RECURSIVE up(id, parent_id) AS (
         SELECT id, parent_id FROM expense_categories WHERE id = @parentId
         UNION
         SELECT e.id, e.parent_id FROM expense_categories e JOIN up ON e.id = up.parent_id
       )
       SELECT 1 AS hit FROM up WHERE id = @id LIMIT 1`,
    )
    .get({ parentId, id })
  if (cycle) throw new CategoryError("Нельзя выбрать дочернюю категорию в качестве родительской", 400, "parentId")
}

/** Writes `options` exactly (a second statement, so the options trigger never re-derives them). */
async function writeOptions(db: PgDb, id: number, options: string) {
  await db.prepare("UPDATE expense_categories SET options = @options WHERE id = @id AND options IS DISTINCT FROM @options").run({ id, options })
}

function values(input: ExpenseCategoryInput) {
  const { options, parameter } = optionColumns(input.option)
  return {
    name: input.name,
    parameter,
    options,
    parentId: input.parentId,
    direct: input.direct ? 1 : 0,
    excludeFromPnl: !input.direct && input.excludeFromPnl ? 1 : 0,
  }
}

export async function createExpenseCategory(input: ExpenseCategoryInput): Promise<ExpenseCategory> {
  await ensureCategorySchema()
  return withTransaction(async (tx) => {
    await lockCategories(tx, "expense")
    await assertNameAvailable(tx, "expense", input.name, null)
    await assertParent(tx, null, input.parentId)
    const row = values(input)
    const result = await tx
      .prepare(
        `INSERT INTO expense_categories (name, parameter, parent_id, direct, exclude_from_pnl, options)
         VALUES (@name, @parameter, @parentId, @direct, @excludeFromPnl, @options)`,
      )
      .run(row)
    const id = Number(result.lastInsertRowid)
    await writeOptions(tx, id, row.options)
    return rowToCategory((await readRow(tx, id))!)
  })
}

/** Demo PUT finance/expense_category/:id. A rename is copied to the money rows linked by id. */
export async function updateExpenseCategory(id: number, input: ExpenseCategoryInput): Promise<ExpenseCategory | null> {
  await ensureCategorySchema()
  return withTransaction(async (tx) => {
    await lockCategories(tx, "expense")
    const current = await readRow(tx, id, true)
    if (!current) return null
    if (current.name !== input.name) await assertNameAvailable(tx, "expense", input.name, id)
    await assertParent(tx, id, input.parentId)
    if (current.name !== input.name) await cascadeCategoryRename(tx, "expense", id, input.name)
    const row = values(input)
    await tx
      .prepare(
        `UPDATE expense_categories SET name = @name, parameter = @parameter, parent_id = @parentId, direct = @direct,
           exclude_from_pnl = @excludeFromPnl, options = @options, updated_at = datetime('now') WHERE id = @id`,
      )
      .run({ ...row, id })
    await writeOptions(tx, id, row.options)
    return rowToCategory((await readRow(tx, id))!)
  })
}

/** Demo DELETE finance/expense_category/:id — refused (409) while money rows or child categories reference it. */
export async function deleteExpenseCategory(id: number): Promise<boolean> {
  await ensureCategorySchema()
  return withTransaction(async (tx) => {
    await lockCategories(tx, "expense")
    const current = await readRow(tx, id, true)
    if (!current) return false
    const usage = await categoryUsage(tx, "expense", current)
    if (usage.length) throw new CategoryError("Удаление невозможно из-за связи с другими данными", 409, undefined, usage)
    const result = await tx.prepare("DELETE FROM expense_categories WHERE id = ?").run(id)
    return result.changes > 0
  })
}
