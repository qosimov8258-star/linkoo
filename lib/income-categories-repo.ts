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

export async function listIncomeCategories(): Promise<IncomeCategory[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM income_categories ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToCategory)
}

export async function getIncomeCategory(id: number): Promise<IncomeCategory | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM income_categories WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToCategory(row) : null
}

export async function createIncomeCategory(input: IncomeCategoryInput): Promise<IncomeCategory> {
  const db = getDb()
  const result = (await db
      .prepare("INSERT INTO income_categories (name, parameter, other_income) VALUES (?, ?, ?)")
      .run(input.name, input.parameter, input.otherIncome ? 1 : 0))
  return (await getIncomeCategory(Number(result.lastInsertRowid)))!
}

export async function updateIncomeCategory(id: number, input: IncomeCategoryInput): Promise<IncomeCategory | null> {
  if (!(await getIncomeCategory(id))) return null
  const db = getDb()
  await db.prepare("UPDATE income_categories SET name = ?, parameter = ?, other_income = ?, updated_at = datetime('now') WHERE id = ?").run(
        input.name,
        input.parameter,
        input.otherIncome ? 1 : 0,
        id,
      )
  return (await getIncomeCategory(id))
}

export async function deleteIncomeCategory(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM income_categories WHERE id = ?").run(id))
  return result.changes > 0
}
