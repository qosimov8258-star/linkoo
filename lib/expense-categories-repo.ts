import "server-only"

import { getDb } from "@/lib/db"
import type { ExpenseCategory } from "@/components/analytics/expense-categories-data"

type Row = {
  id: number
  name: string
  parameter: string
  parent_id: number | null
  direct: number
  exclude_from_pnl: number
  created_at: string
}

function rowToCategory(row: Row): ExpenseCategory {
  return {
    id: row.id,
    name: row.name,
    parameter: row.parameter,
    parentId: row.parent_id,
    direct: row.direct === 1,
    excludeFromPnl: row.exclude_from_pnl === 1,
    createdDate: new Date(row.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }),
  }
}

export type ExpenseCategoryInput = { name: string; parameter: string; parentId: number | null; direct: boolean; excludeFromPnl: boolean }

export function parseExpenseCategoryInput(body: unknown): ExpenseCategoryInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const parentIdRaw = value.parentId
  const parentId = typeof parentIdRaw === "number" && Number.isFinite(parentIdRaw) ? parentIdRaw : null
  return {
    name,
    parameter: typeof value.parameter === "string" ? value.parameter.trim() : "",
    parentId,
    direct: value.direct === true,
    excludeFromPnl: value.excludeFromPnl === true,
  }
}

export function listExpenseCategories(): ExpenseCategory[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM expense_categories ORDER BY id DESC").all() as Row[]
  return rows.map(rowToCategory)
}

export function getExpenseCategory(id: number): ExpenseCategory | null {
  const db = getDb()
  const row = db.prepare("SELECT * FROM expense_categories WHERE id = ?").get(id) as Row | undefined
  return row ? rowToCategory(row) : null
}

export function createExpenseCategory(input: ExpenseCategoryInput): ExpenseCategory {
  const db = getDb()
  const result = db
    .prepare("INSERT INTO expense_categories (name, parameter, parent_id, direct, exclude_from_pnl) VALUES (@name, @parameter, @parentId, @direct, @excludeFromPnl)")
    .run({
      name: input.name,
      parameter: input.parameter,
      parentId: input.parentId,
      direct: input.direct ? 1 : 0,
      excludeFromPnl: input.excludeFromPnl ? 1 : 0,
    })
  return getExpenseCategory(Number(result.lastInsertRowid))!
}

export function updateExpenseCategory(id: number, input: ExpenseCategoryInput): ExpenseCategory | null {
  if (!getExpenseCategory(id)) return null
  const db = getDb()
  db.prepare(
    `UPDATE expense_categories SET name = @name, parameter = @parameter, parent_id = @parentId,
       direct = @direct, exclude_from_pnl = @excludeFromPnl, updated_at = datetime('now') WHERE id = @id`,
  ).run({
    id,
    name: input.name,
    parameter: input.parameter,
    parentId: input.parentId,
    direct: input.direct ? 1 : 0,
    excludeFromPnl: input.excludeFromPnl ? 1 : 0,
  })
  return getExpenseCategory(id)
}

// Matches the original UI behaviour: deleting a category also removes any
// direct children pointing at it as their parent (one level, not recursive).
export function deleteExpenseCategory(id: number): boolean {
  const db = getDb()
  const result = db.prepare("DELETE FROM expense_categories WHERE id = ? OR parent_id = ?").run(id, id)
  return result.changes > 0
}
