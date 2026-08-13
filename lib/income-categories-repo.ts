import "server-only"

import { getDb } from "@/lib/db"
import type { IncomeCategory } from "@/components/analytics/income-categories-data"

type Row = { id: number; name: string; parameter: string; other_income: number; created_at: string }

function rowToCategory(row: Row): IncomeCategory {
  return {
    id: row.id,
    name: row.name,
    parameter: row.parameter,
    otherIncome: row.other_income === 1,
    createdDate: new Date(row.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }),
  }
}

export type IncomeCategoryInput = { name: string; parameter: string; otherIncome: boolean }

export function parseIncomeCategoryInput(body: unknown): IncomeCategoryInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  return {
    name,
    parameter: typeof value.parameter === "string" ? value.parameter.trim() : "",
    otherIncome: value.otherIncome === true,
  }
}

export function listIncomeCategories(): IncomeCategory[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM income_categories ORDER BY id DESC").all() as Row[]
  return rows.map(rowToCategory)
}

export function getIncomeCategory(id: number): IncomeCategory | null {
  const db = getDb()
  const row = db.prepare("SELECT * FROM income_categories WHERE id = ?").get(id) as Row | undefined
  return row ? rowToCategory(row) : null
}

export function createIncomeCategory(input: IncomeCategoryInput): IncomeCategory {
  const db = getDb()
  const result = db
    .prepare("INSERT INTO income_categories (name, parameter, other_income) VALUES (?, ?, ?)")
    .run(input.name, input.parameter, input.otherIncome ? 1 : 0)
  return getIncomeCategory(Number(result.lastInsertRowid))!
}

export function updateIncomeCategory(id: number, input: IncomeCategoryInput): IncomeCategory | null {
  if (!getIncomeCategory(id)) return null
  const db = getDb()
  db.prepare("UPDATE income_categories SET name = ?, parameter = ?, other_income = ?, updated_at = datetime('now') WHERE id = ?").run(
    input.name,
    input.parameter,
    input.otherIncome ? 1 : 0,
    id,
  )
  return getIncomeCategory(id)
}

export function deleteIncomeCategory(id: number): boolean {
  const db = getDb()
  const result = db.prepare("DELETE FROM income_categories WHERE id = ?").run(id)
  return result.changes > 0
}
