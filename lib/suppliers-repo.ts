import "server-only"

import { z } from "zod"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type { Supplier, SupplierContact, SupplierProduct } from "@/components/analytics/suppliers-data"
import {
  ensureProcurementFunctions,
  fieldError,
  findBranch,
  findOrganization,
  findSupplierCategory,
  isPlaceholder,
  nameKey,
  ProcurementError,
  tableColumns,
  type ProcurementUsage,
} from "@/lib/supplier-refs"

// "Поставщики". Documents store the supplier by NAME (supplier_incomings.supplier,
// supplier_returns.from_whom, legacy supplier_payments.supplier, products /
// raw_materials.supplier) or by id (supplier_payments.supplier_id,
// supplier_balance_transactions, invoice_incomings, raw_materials.supplier_id);
// the finance ledger maps a name to the supplier with the lowest id. So:
//   * names are unique by the finance name key (fin_key);
//   * category / branch / organization must exist in their dictionaries
//     (branch / organization may be "Не указано");
//   * a rename is carried over to every document that stores the name, in the
//     same transaction, so the balance never splits into a phantom "name:" row;
//   * a supplier that documents reference cannot be deleted (409 + usage).
// Legacy twins (same key, created before the check): name-based documents belong
// to the lowest id (the ledger rule) and are only moved / counted for that one.

type Row = {
  id: number
  name: string
  category: string
  created_date: string
  address: string
  branch: string
  organization: string
  contacts: string
  products: string
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function rowToSupplier(row: Row): Supplier {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    createdDate: row.created_date,
    address: row.address,
    branch: row.branch,
    organization: row.organization,
    contacts: parseJsonArray<SupplierContact>(row.contacts),
    products: parseJsonArray<SupplierProduct>(row.products),
  }
}

const monthNames = ["янв.", "февр.", "марта", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function formatToday() {
  const date = new Date()
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

export type SupplierInput = {
  name: string
  category: string
  address: string
  branch: string
  organization: string
  contacts: SupplierContact[]
}

/** POST /api/suppliers, PUT /api/suppliers/[id]. */
export const supplierSchema = z.object({
  name: z.string({ error: "Название обязательно" }).trim().min(1, "Название обязательно").max(255, "Не более 255 символов"),
  category: z.string({ error: "Выберите категорию" }).trim().min(1, "Выберите категорию").max(255, "Не более 255 символов"),
  address: z.string({ error: "Адрес обязателен" }).trim().min(1, "Адрес обязателен").max(1000, "Не более 1000 символов"),
  branch: z.string().max(255, "Не более 255 символов").optional(),
  organization: z.string().max(255, "Не более 255 символов").optional(),
  contacts: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
})

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "")

export function parseSupplierInput(body: unknown): SupplierInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = clean(value.name)
  const category = clean(value.category)
  const address = typeof value.address === "string" ? value.address.trim() : ""
  if (!name || !category || !address) return null
  const contactsRaw = Array.isArray(value.contacts) ? (value.contacts as SupplierContact[]) : []
  return {
    name,
    category,
    address,
    branch: clean(value.branch) || "Не указано",
    organization: clean(value.organization) || "Не указано",
    contacts: contactsRaw
      .filter((contact) => contact && (String(contact.name ?? "").trim() || String(contact.phone ?? "").trim()))
      .map((contact, index) => ({
        id: Number(contact.id) || index + 1,
        name: String(contact.name ?? ""),
        email: String(contact.email ?? ""),
        phone: String(contact.phone ?? ""),
      })),
  }
}

async function suppliersDb(): Promise<PgDb> {
  const db = getDb()
  await ensureProcurementFunctions(db)
  return db
}

/** Serialises supplier writes (uniqueness check + insert / rename / delete). */
async function lockSuppliers(tx: PgDb) {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:suppliers')) AS ok").get()
}

async function readRow(db: PgDb, id: number, lock = false): Promise<Row | undefined> {
  return (await db.prepare(`SELECT * FROM suppliers WHERE id = ?${lock ? " FOR UPDATE" : ""}`).get(id)) as Row | undefined
}

export async function listSuppliers(): Promise<Supplier[]> {
  const db = getDb()
  return ((await db.prepare("SELECT * FROM suppliers ORDER BY id DESC").all()) as Row[]).map(rowToSupplier)
}

export async function getSupplier(id: number): Promise<Supplier | null> {
  const row = await readRow(getDb(), id)
  return row ? rowToSupplier(row) : null
}

async function assertNameAvailable(tx: PgDb, name: string, exceptId: number | null) {
  if (!nameKey(name) || isPlaceholder(name)) throw fieldError("name", "Недопустимое наименование поставщика")
  const duplicate = await tx
    .prepare("SELECT id FROM suppliers WHERE fin_key(name) = fin_key(@name) AND (@exceptId::int IS NULL OR id <> @exceptId::int) LIMIT 1")
    .get({ name, exceptId })
  if (duplicate) throw fieldError("name", "Поставщик с таким наименованием уже существует", 409)
}

/** Canonical category / branch / organization names; unknown ones are refused
 * (a value the supplier already had is kept as is, so legacy rows stay editable). */
async function resolveRefs(tx: PgDb, input: SupplierInput, current?: Row): Promise<SupplierInput> {
  const unchanged = (field: "category" | "branch" | "organization") => Boolean(current) && nameKey(current![field]) === nameKey(input[field])
  const category = await findSupplierCategory(tx, input.category)
  if (!category && !unchanged("category")) throw fieldError("category", "Категория не найдена")
  let branch = "Не указано"
  if (!isPlaceholder(input.branch)) {
    const found = await findBranch(tx, input.branch)
    if (!found && !unchanged("branch")) throw fieldError("branch", "Филиал не найден")
    branch = found?.name ?? input.branch
  }
  let organization = "Не указано"
  if (!isPlaceholder(input.organization)) {
    const found = await findOrganization(tx, input.organization)
    if (!found && !unchanged("organization")) throw fieldError("organization", "Организация не найдена")
    organization = found?.name ?? input.organization
  }
  return { ...input, category: category?.name ?? input.category, branch, organization }
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  await suppliersDb()
  return withTransaction(async (tx) => {
    await lockSuppliers(tx)
    await assertNameAvailable(tx, input.name, null)
    const value = await resolveRefs(tx, input)
    const result = await tx
      .prepare(
        `INSERT INTO suppliers (name, category, created_date, address, branch, organization, contacts, products, updated_at)
         VALUES (@name, @category, @createdDate, @address, @branch, @organization, @contacts, '[]', datetime('now'))`,
      )
      .run({
        name: value.name,
        category: value.category,
        createdDate: formatToday(),
        address: value.address,
        branch: value.branch,
        organization: value.organization,
        contacts: JSON.stringify(value.contacts),
      })
    return rowToSupplier((await readRow(tx, Number(result.lastInsertRowid)))!)
  })
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

type Reference = { table: string; label: string; byName?: string; byId?: string }

/** Every column that stores a supplier (by name and / or by id). */
const REFERENCES: Reference[] = [
  { table: "supplier_incomings", label: "Приход от поставщика", byName: "supplier" },
  { table: "supplier_returns", label: "Возврат поставщику", byName: "from_whom" },
  { table: "supplier_payments", label: "Оплаты поставщикам", byName: "supplier", byId: "supplier_id" },
  { table: "supplier_balance_transactions", label: "Баланс поставщиков", byId: "supplier_id" },
  { table: "invoice_incomings", label: "Входящие счет фактуры", byId: "supplier_id" },
  { table: "products", label: "Продукты", byName: "supplier" },
  { table: "raw_materials", label: "Сырье", byName: "supplier", byId: "supplier_id" },
]

async function existingReferences(tx: PgDb): Promise<Reference[]> {
  const columns = await tableColumns(
    tx,
    REFERENCES.map((ref) => ref.table),
  )
  return REFERENCES.map((ref) => ({
    ...ref,
    byName: ref.byName && columns.get(ref.table)?.has(ref.byName) ? ref.byName : undefined,
    byId: ref.byId && columns.get(ref.table)?.has(ref.byId) ? ref.byId : undefined,
  })).filter((ref) => ref.byName || ref.byId)
}

/** Rows of `ref` that point at the supplier: by id, and — when `withNames` — by name
 * (rows that carry an id only count by that id). */
function referenceWhere(ref: Reference, withNames: boolean): string | null {
  const parts: string[] = []
  if (ref.byId) parts.push(`${ref.byId} = @id`)
  if (withNames && ref.byName) parts.push(ref.byId ? `(${ref.byId} IS NULL AND fin_key(${ref.byName}) = fin_key(@name))` : `fin_key(${ref.byName}) = fin_key(@name)`)
  return parts.length ? parts.join(" OR ") : null
}

/** The supplier owns its name: no other row with the same key and a lower id. */
async function ownsName(tx: PgDb, row: Row): Promise<boolean> {
  return !(await tx.prepare("SELECT 1 AS hit FROM suppliers WHERE fin_key(name) = fin_key(@name) AND id < @id LIMIT 1").get({ name: row.name, id: row.id }))
}

async function hasTwin(tx: PgDb, row: Row): Promise<boolean> {
  return Boolean(await tx.prepare("SELECT 1 AS hit FROM suppliers WHERE fin_key(name) = fin_key(@name) AND id <> @id LIMIT 1").get({ name: row.name, id: row.id }))
}

async function supplierUsage(tx: PgDb, row: Row): Promise<ProcurementUsage[]> {
  // With a twin left, name-based documents keep a valid supplier after the delete.
  const withNames = !(await hasTwin(tx, row))
  const usage: ProcurementUsage[] = []
  for (const ref of await existingReferences(tx)) {
    const where = referenceWhere(ref, withNames)
    if (!where) continue
    const result = (await tx.prepare(`SELECT COUNT(*) AS n FROM ${ref.table} WHERE ${where}`).get({ id: row.id, name: row.name })) as { n: string | number } | undefined
    const count = Number(result?.n ?? 0)
    if (count > 0) usage.push({ table: ref.table, label: ref.label, count })
  }
  return usage
}

/** Points the documents of `row` at `newName`; returns the rows changed per table. */
async function cascadeRename(tx: PgDb, row: Row, newName: string): Promise<Array<{ table: string; rows: number }>> {
  const withNames = await ownsName(tx, row)
  const changes: Array<{ table: string; rows: number }> = []
  for (const ref of await existingReferences(tx)) {
    // Only name columns carry the spelling; e-invoices keep the seller name printed on the document.
    if (!ref.byName || ref.table === "invoice_incomings") continue
    const where = referenceWhere(ref, withNames)
    if (!where) continue
    const result = await tx.prepare(`UPDATE ${ref.table} SET ${ref.byName} = @newName WHERE (${where}) AND ${ref.byName} IS DISTINCT FROM @newName`).run({ id: row.id, name: row.name, newName })
    if (result.changes > 0) changes.push({ table: ref.table, rows: result.changes })
  }
  return changes
}

/** Edit; a rename is carried over to the documents (same transaction). null = not found. */
export async function updateSupplier(id: number, input: SupplierInput): Promise<Supplier | null> {
  await suppliersDb()
  return withTransaction(async (tx) => {
    await lockSuppliers(tx)
    const current = await readRow(tx, id, true)
    if (!current) return null
    if (current.name !== input.name) {
      await assertNameAvailable(tx, input.name, id)
      await cascadeRename(tx, current, input.name)
    }
    const value = await resolveRefs(tx, input, current)
    await tx
      .prepare(
        `UPDATE suppliers SET name = @name, category = @category, address = @address, branch = @branch,
           organization = @organization, contacts = @contacts, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        name: value.name,
        category: value.category,
        address: value.address,
        branch: value.branch,
        organization: value.organization,
        contacts: JSON.stringify(value.contacts),
      })
    return rowToSupplier((await readRow(tx, id))!)
  })
}

/** Refused with 409 "Удаление невозможно из-за связи с другими данными" (+ usage) while documents reference the supplier. */
export async function deleteSupplier(id: number): Promise<boolean> {
  await suppliersDb()
  return withTransaction(async (tx) => {
    await lockSuppliers(tx)
    const current = await readRow(tx, id, true)
    if (!current) return false
    const usage = await supplierUsage(tx, current)
    if (usage.length) throw new ProcurementError("Удаление невозможно из-за связи с другими данными", 409, undefined, { usage })
    return (await tx.prepare("DELETE FROM suppliers WHERE id = ?").run(id)).changes > 0
  })
}

export type ReserveInput = { product: string; qty: number; price: number; currency: string }

/** "Добавить продукт": products the supplier holds for us (reserve). Adding
 * a product that is already reserved updates its quantity and price. */
export async function addSupplierReserve(id: number, lines: ReserveInput[]): Promise<Supplier | null> {
  return withTransaction(async (tx) => {
    const row = await readRow(tx, id, true)
    if (!row) return null
    const products = [...rowToSupplier(row).products]
    for (const line of lines) {
      const existing = products.find((item) => item.product === line.product)
      if (existing) Object.assign(existing, { qty: line.qty, price: line.price, currency: line.currency })
      else products.push({ id: Math.max(0, ...products.map((item) => item.id)) + 1, product: line.product, qty: line.qty, price: line.price, currency: line.currency })
    }
    await tx.prepare("UPDATE suppliers SET products = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(products), id)
    return rowToSupplier((await readRow(tx, id))!)
  })
}

export async function removeSupplierReserve(id: number, rowId: number): Promise<Supplier | null> {
  return withTransaction(async (tx) => {
    const row = await readRow(tx, id, true)
    if (!row) return null
    const products = rowToSupplier(row).products.filter((item) => item.id !== rowId)
    await tx.prepare("UPDATE suppliers SET products = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(products), id)
    return rowToSupplier((await readRow(tx, id))!)
  })
}
