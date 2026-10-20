import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type { SupplierCategory } from "@/components/analytics/supplier-categories-data"
import { ensureProcurementFunctions, fieldError, nameKey, ProcurementError, type ProcurementUsage } from "@/lib/supplier-refs"

// "Категории поставщиков". suppliers.category stores the category NAME, so:
//   * names are unique by the finance name key (fin_key: case / spacing ignored);
//   * a rename is carried over to the suppliers in the same transaction;
//   * a category that suppliers still use cannot be deleted (409 + usage).
// Legacy twins (two rows with the same key, created before the check) keep
// working: suppliers follow a renamed / deleted twin only when no other row
// still carries their category name.

type Row = { id: number; name: string }

export type SupplierCategoryInput = { name: string }

export function parseSupplierCategoryInput(body: unknown): SupplierCategoryInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.replace(/\s+/g, " ").trim() : ""
  if (!name) return null
  return { name }
}

async function categoriesDb(): Promise<PgDb> {
  const db = getDb()
  await ensureProcurementFunctions(db)
  return db
}

/** Serialises category writes (uniqueness check + insert / rename / delete). */
async function lockCategories(tx: PgDb) {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:supplier_categories')) AS ok").get()
}

async function readRow(db: PgDb, id: number, lock = false): Promise<Row | undefined> {
  return (await db.prepare(`SELECT id, name FROM supplier_categories WHERE id = ?${lock ? " FOR UPDATE" : ""}`).get(id)) as Row | undefined
}

async function assertNameAvailable(tx: PgDb, name: string, exceptId: number | null) {
  if (!nameKey(name)) throw fieldError("name", "Наименование обязательно")
  const duplicate = await tx
    .prepare("SELECT id FROM supplier_categories WHERE fin_key(name) = fin_key(@name) AND (@exceptId::int IS NULL OR id <> @exceptId::int) LIMIT 1")
    .get({ name, exceptId })
  if (duplicate) throw fieldError("name", "Категория с таким наименованием уже существует", 409)
}

/** Another category row still carries this name (legacy twin). */
async function hasTwin(tx: PgDb, name: string, id: number): Promise<boolean> {
  return Boolean(await tx.prepare("SELECT 1 AS hit FROM supplier_categories WHERE fin_key(name) = fin_key(@name) AND id <> @id LIMIT 1").get({ name, id }))
}

export async function listSupplierCategories(): Promise<SupplierCategory[]> {
  const db = getDb()
  return (await db.prepare("SELECT id, name FROM supplier_categories ORDER BY id DESC").all()) as Row[]
}

export async function getSupplierCategory(id: number): Promise<SupplierCategory | null> {
  return (await readRow(getDb(), id)) ?? null
}

export async function createSupplierCategory(input: SupplierCategoryInput): Promise<SupplierCategory> {
  await categoriesDb()
  return withTransaction(async (tx) => {
    await lockCategories(tx)
    await assertNameAvailable(tx, input.name, null)
    const result = await tx.prepare("INSERT INTO supplier_categories (name) VALUES (?)").run(input.name)
    return (await readRow(tx, Number(result.lastInsertRowid)))!
  })
}

/** Renames the category; suppliers on the old name follow it. `renamedSuppliers` = suppliers moved. */
export async function updateSupplierCategory(id: number, input: SupplierCategoryInput): Promise<(SupplierCategory & { renamedSuppliers: number }) | null> {
  await categoriesDb()
  return withTransaction(async (tx) => {
    await lockCategories(tx)
    const current = await readRow(tx, id, true)
    if (!current) return null
    let renamedSuppliers = 0
    if (current.name !== input.name) {
      await assertNameAvailable(tx, input.name, id)
      if (!(await hasTwin(tx, current.name, id))) {
        const result = await tx
          .prepare("UPDATE suppliers SET category = @next, updated_at = datetime('now') WHERE fin_key(category) = fin_key(@old) AND category IS DISTINCT FROM @next")
          .run({ next: input.name, old: current.name })
        renamedSuppliers = result.changes
      }
      await tx.prepare("UPDATE supplier_categories SET name = ?, updated_at = datetime('now') WHERE id = ?").run(input.name, id)
    }
    return { ...(await readRow(tx, id))!, renamedSuppliers }
  })
}

/** Refused (409 + usage) while suppliers use the category. */
export async function deleteSupplierCategory(id: number): Promise<boolean> {
  await categoriesDb()
  return withTransaction(async (tx) => {
    await lockCategories(tx)
    const current = await readRow(tx, id, true)
    if (!current) return false
    if (!(await hasTwin(tx, current.name, id))) {
      const row = (await tx.prepare("SELECT COUNT(*) AS n FROM suppliers WHERE fin_key(category) = fin_key(@name)").get({ name: current.name })) as { n: string | number }
      const count = Number(row?.n ?? 0)
      if (count > 0) {
        const usage: ProcurementUsage[] = [{ table: "suppliers", label: "Поставщики", count }]
        throw new ProcurementError("Удаление невозможно из-за связи с другими данными", 409, undefined, { usage })
      }
    }
    return (await tx.prepare("DELETE FROM supplier_categories WHERE id = ?").run(id)).changes > 0
  })
}
