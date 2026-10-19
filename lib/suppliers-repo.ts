import "server-only"

import { getDb } from "@/lib/db"
import type { Supplier, SupplierContact, SupplierProduct } from "@/components/analytics/suppliers-data"

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

function rowToSupplier(row: Row): Supplier {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    createdDate: row.created_date,
    address: row.address,
    branch: row.branch,
    organization: row.organization,
    contacts: JSON.parse(row.contacts) as SupplierContact[],
    products: JSON.parse(row.products) as SupplierProduct[],
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

export function parseSupplierInput(body: unknown): SupplierInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  const category = typeof value.category === "string" ? value.category.trim() : ""
  const address = typeof value.address === "string" ? value.address.trim() : ""
  if (!name || !category || !address) return null
  const contactsRaw = Array.isArray(value.contacts) ? (value.contacts as SupplierContact[]) : []
  return {
    name,
    category,
    address,
    branch: typeof value.branch === "string" && value.branch ? value.branch : "Не указано",
    organization: typeof value.organization === "string" && value.organization ? value.organization : "Не указано",
    contacts: contactsRaw
      .filter((contact) => contact && (contact.name?.trim() || contact.phone?.trim()))
      .map((contact, index) => ({
        id: Number(contact.id) || index + 1,
        name: String(contact.name ?? ""),
        email: String(contact.email ?? ""),
        phone: String(contact.phone ?? ""),
      })),
  }
}

export async function listSuppliers(): Promise<Supplier[]> {
  const db = getDb()
  return ((await db.prepare("SELECT * FROM suppliers ORDER BY id DESC").all()) as Row[]).map(rowToSupplier)
}

export async function getSupplier(id: number): Promise<Supplier | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToSupplier(row) : null
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO suppliers (name, category, created_date, address, branch, organization, contacts, products, updated_at)
       VALUES (@name, @category, @createdDate, @address, @branch, @organization, @contacts, '[]', datetime('now'))`,
      )
      .run({
        name: input.name,
        category: input.category,
        createdDate: formatToday(),
        address: input.address,
        branch: input.branch,
        organization: input.organization,
        contacts: JSON.stringify(input.contacts),
      }))
  return (await getSupplier(Number(result.lastInsertRowid)))!
}

export async function updateSupplier(id: number, input: SupplierInput): Promise<Supplier | null> {
  const db = getDb()
  if (!(await getSupplier(id))) return null
  await db.prepare(
        `UPDATE suppliers SET name = @name, category = @category, address = @address, branch = @branch,
       organization = @organization, contacts = @contacts, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        name: input.name,
        category: input.category,
        address: input.address,
        branch: input.branch,
        organization: input.organization,
        contacts: JSON.stringify(input.contacts),
      })
  return (await getSupplier(id))
}

export async function deleteSupplier(id: number): Promise<boolean> {
  const db = getDb()
  return (await db.prepare("DELETE FROM suppliers WHERE id = ?").run(id)).changes > 0
}

export type ReserveInput = { product: string; qty: number; price: number; currency: string }

/** "Добавить продукт": products the supplier holds for us (reserve). Adding
 * a product that is already reserved updates its quantity and price. */
export async function addSupplierReserve(id: number, lines: ReserveInput[]): Promise<Supplier | null> {
  const supplier = await getSupplier(id)
  if (!supplier) return null
  const products = [...supplier.products]
  for (const line of lines) {
    const existing = products.find((item) => item.product === line.product)
    if (existing) Object.assign(existing, { qty: line.qty, price: line.price, currency: line.currency })
    else products.push({ id: Math.max(0, ...products.map((item) => item.id)) + 1, product: line.product, qty: line.qty, price: line.price, currency: line.currency })
  }
  await getDb().prepare("UPDATE suppliers SET products = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(products), id)
  return getSupplier(id)
}

export async function removeSupplierReserve(id: number, rowId: number): Promise<Supplier | null> {
  const supplier = await getSupplier(id)
  if (!supplier) return null
  const products = supplier.products.filter((item) => item.id !== rowId)
  await getDb().prepare("UPDATE suppliers SET products = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(products), id)
  return getSupplier(id)
}
