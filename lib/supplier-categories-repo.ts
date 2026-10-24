import "server-only"

import { getDb } from "@/lib/db"
import type { SupplierCategory } from "@/components/analytics/supplier-categories-data"

type Row = { id: number; name: string }

export type SupplierCategoryInput = { name: string }

export function parseSupplierCategoryInput(body: unknown): SupplierCategoryInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  return { name }
}

export async function listSupplierCategories(): Promise<SupplierCategory[]> {
  const db = getDb()
  return (await db.prepare("SELECT id, name FROM supplier_categories ORDER BY id DESC").all()) as Row[]
}

export async function getSupplierCategory(id: number): Promise<SupplierCategory | null> {
  const db = getDb()
  return ((await db.prepare("SELECT id, name FROM supplier_categories WHERE id = ?").get(id)) as Row | undefined) ?? null
}

export async function createSupplierCategory(input: SupplierCategoryInput): Promise<SupplierCategory> {
  const db = getDb()
  const result = (await db.prepare("INSERT INTO supplier_categories (name) VALUES (?)").run(input.name))
  return (await getSupplierCategory(Number(result.lastInsertRowid)))!
}

export async function updateSupplierCategory(id: number, input: SupplierCategoryInput): Promise<SupplierCategory | null> {
  if (!(await getSupplierCategory(id))) return null
  const db = getDb()
  await db.prepare("UPDATE supplier_categories SET name = ?, updated_at = datetime('now') WHERE id = ?").run(input.name, id)
  return (await getSupplierCategory(id))
}

export async function deleteSupplierCategory(id: number): Promise<boolean> {
  const db = getDb()
  return (await db.prepare("DELETE FROM supplier_categories WHERE id = ?").run(id)).changes > 0
}

/** Suppliers keep the category by name, so a category in use cannot be deleted. */
export async function isSupplierCategoryUsed(id: number): Promise<boolean> {
  const category = await getSupplierCategory(id)
  if (!category) return false
  const db = getDb()
  const row = (await db.prepare("SELECT count(*) AS n FROM suppliers WHERE category = ?").get(category.name)) as { n: number | string }
  return Number(row.n) > 0
}
