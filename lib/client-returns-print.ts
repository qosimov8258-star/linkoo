import "server-only"

import { getClientReturn, type ClientReturn } from "@/lib/client-returns-repo"
import { getDb, type PgDb } from "@/lib/db"
import { renderDocTemplate, stripActiveContent, type TemplateContext } from "@/lib/doc-template-render"
import { getDocTemplate } from "@/lib/doc-templates-repo"
import { loadCurrencyContext } from "@/lib/finance/context"
import { parseAnyDate } from "@/lib/finance/dates"
import { currencyLabel } from "@/lib/finance/currency"

// Printing client returns (Продажи → Возвраты), like the reference:
// - a print template of Справочники → Шаблоны документов (key "order_return") merged with each return, `count`
//   copies of every return (the reference's saas/merge_template/ over sales/order_return/print/?ids=…);
// - «Для зав.склада» → «Распечатать» / «Сводка для склада»: the products of the selected returns summed per product
//   (the reference's sales/order_return/custom_release/?ids=…).

export const RETURN_TEMPLATE_KEY = "order_return"
export const MAX_PRINT_IDS = 500
export const MAX_PRINT_COPIES = 50

export class ReturnPrintError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type ClientExtra = { id: number; address: string | null; landmark: string | null; phone: string | null; name: string }
type ProductExtra = { id: number; barcode: string | null; article: string | null; integration_code: string | null; type: string | null; unit: string | null; box_amount: string | number | null; box_unit: string | null }

const blank = (value: unknown) => {
  const text = String(value ?? "").trim()
  return text && !/^не установлен/i.test(text) ? text : ""
}

/** The barcodes of a product: the catalog keeps them in one text ("4606025, 123"), "не установлен" when none. */
const barcodesOf = (value: unknown) =>
  String(value ?? "")
    .split(/[,;\n]/)
    .map(blank)
    .filter(Boolean)

/** When the return was made, as stored local time ("2026-07-17T08:24:09"): a return copied from the reference keeps
 * its creation time in the return date; one made here has a bare day there and its creation moment in created_at (UTC). */
function createdLocal(row: ClientReturn): string {
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(row.returnDate)) return row.returnDate.replace(" ", "T").slice(0, 19)
  return parseAnyDate(row.createdAt, true) ?? row.returnDate
}

/** "Name Surname" → the reference's {first_name, second_name}; the whole name stays in first_name. */
const person = (name: string, extra: Record<string, unknown> = {}) => ({ first_name: name, second_name: "", full_name: name, ...extra })

async function clientsOf(db: PgDb, ids: number[]): Promise<Map<number, ClientExtra>> {
  if (!ids.length) return new Map()
  const rows = (await db.prepare("SELECT id, name, address, landmark, phone FROM clients WHERE id = ANY(?::int[])").all(ids)) as ClientExtra[]
  return new Map(rows.map((row) => [row.id, row]))
}

async function productsOf(db: PgDb, ids: number[]): Promise<Map<number, ProductExtra>> {
  if (!ids.length) return new Map()
  const rows = (await db
    .prepare(
      `SELECT id, to_jsonb(p) ->> 'barcode' AS barcode, to_jsonb(p) ->> 'article' AS article, to_jsonb(p) ->> 'integration_code' AS integration_code,
              to_jsonb(p) ->> 'type' AS type, to_jsonb(p) ->> 'unit' AS unit, to_jsonb(p) ->> 'box_amount' AS box_amount, to_jsonb(p) ->> 'box_unit' AS box_unit
         FROM products p WHERE id = ANY(?::int[])`,
    )
    .all(ids)) as ProductExtra[]
  return new Map(rows.map((row) => [row.id, row]))
}

/** Phones of employees by their display name ("Имя Фамилия"). */
async function employeePhones(db: PgDb, names: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  if (!wanted.length) return new Map()
  const rows = (await db
    .prepare("SELECT btrim(concat_ws(' ', first_name, last_name)) AS name, phone FROM employees WHERE btrim(concat_ws(' ', first_name, last_name)) = ANY(?::text[])")
    .all(wanted)) as Array<{ name: string; phone: string | null }>
  const phones = new Map<string, string>()
  for (const row of rows) if (!phones.has(row.name) && blank(row.phone)) phones.set(row.name, blank(row.phone))
  return phones
}

/** «Тип сделки» of a return: its order's (0 = Стандартный, 1 = Консигнация), else standard. */
async function dealTypes(db: PgDb, orderIds: number[]): Promise<Map<number, string>> {
  if (!orderIds.length) return new Map()
  const rows = (await db.prepare("SELECT id, deal_type FROM orders WHERE id = ANY(?::int[])").all(orderIds)) as Array<{ id: number; deal_type: string | number | null }>
  return new Map(rows.map((row) => [row.id, String(row.deal_type ?? "").trim() === "1" ? "1" : "0"]))
}

async function loadReturns(ids: number[]): Promise<ClientReturn[]> {
  const rows: ClientReturn[] = []
  for (const id of ids) {
    const row = await getClientReturn(id)
    if (row) rows.push(row)
  }
  return rows
}

/** The data a return template prints, under the reference's names (id, created_date, market, stock, returned_products…). */
async function templateContexts(db: PgDb, rows: ClientReturn[]): Promise<TemplateContext[]> {
  await loadCurrencyContext(db)
  const clients = await clientsOf(db, rows.map((row) => row.clientId).filter((id): id is number => id !== null))
  const products = await productsOf(db, [...new Set(rows.flatMap((row) => (row.items ?? []).map((item) => item.productId)).filter((id): id is number => id !== null))])
  const phones = await employeePhones(db, rows.flatMap((row) => [row.agent, row.deliverer, row.createdBy]))
  const deals = await dealTypes(db, rows.map((row) => row.orderId).filter((id): id is number => id !== null))
  return rows.map((row) => {
    const client = row.clientId === null ? undefined : clients.get(row.clientId)
    const phoneList = String(client?.phone ?? "")
      .split(/[,;]/)
      .map(blank)
      .filter((phone) => phone && phone !== "-")
    const currency = currencyLabel(row.currency)
    const items = row.items ?? []
    const returnedProducts = items.map((item, index) => {
      const product = item.productId === null ? undefined : products.get(item.productId)
      const barcodes = barcodesOf(product?.barcode)
      return {
        id: item.id,
        position: index + 1,
        amount: item.quantity,
        price: item.price,
        total: item.total,
        order: item.orderId ?? row.orderId,
        currency: { name: currency },
        product: {
          id: item.productId,
          name: item.productName,
          code: blank(product?.integration_code) || null,
          vendor_code: blank(product?.article) || null,
          barcode: barcodes[0] ?? null,
          barcodes,
          measurement: { name: item.unit || blank(product?.unit) },
          type: { name: blank(product?.type) },
        },
      }
    })
    const market = {
      id: row.clientId,
      name: row.client,
      address: blank(client?.address) || null,
      guide: blank(client?.landmark) || null,
      phones: phoneList.map((phone) => ({ phone })),
      branch: { name: row.branch },
      border: { title: row.zone },
    }
    return {
      id: row.id,
      order: row.orderId,
      status: row.status,
      created_date: createdLocal(row),
      accepted_time: row.acceptedAt,
      comment: row.comment || null,
      deal_type: (row.orderId !== null && deals.get(row.orderId)) || "0",
      market,
      client: { id: row.clientId, name: row.account || row.client },
      stock: { name: row.warehouse },
      responsible_agent: person(row.agent, { phone_number: phones.get(row.agent.trim()) ?? null }),
      delivery_man: person(row.deliverer, { phone_number: phones.get(row.deliverer.trim()) ?? null }),
      created_by: person(row.createdBy, { phone_number: phones.get(row.createdBy.trim()) ?? null }),
      currency: { name: currency },
      payment_type: row.paymentType || null,
      division_name: row.organization,
      returned_products: returnedProducts,
      total_price: row.amount,
      total_amount: items.reduce((sum, item) => sum + item.quantity, 0),
      // The reference prints its main currency here; a return is printed in its own currency.
      PRIMARY_CURRENCY: currency,
    }
  })
}

/** The printed pages: the template merged with every return (newest first), `count` copies of each. */
export async function renderReturnPrintPages(ids: number[], templateId: number, count: number): Promise<string[]> {
  const template = await getDocTemplate(templateId)
  if (!template || template.keyName !== RETURN_TEMPLATE_KEY) throw new ReturnPrintError("Шаблон не найден", 404)
  const rows = await loadReturns([...new Set(ids)].sort((a, b) => b - a))
  if (!rows.length) throw new ReturnPrintError("Возврат не найден", 404)
  const contexts = await templateContexts(getDb(), rows)
  const pages: string[] = []
  for (const context of contexts) {
    const html = stripActiveContent(renderDocTemplate(template.html, context))
    for (let copy = 0; copy < count; copy++) pages.push(html)
  }
  return pages
}

export type ReturnReleaseProduct = {
  id: number | null
  name: string
  unit: string
  type: string
  barcodes: string[]
  vendorCode: string
  boxAmount: number
  boxUnit: string
  /** The reference's `count`: the returned quantity as a whole number (12.1 → 12). Its sheets print it unless its
   * RETURN_PRINT_TOTAL_AMOUNT setting is on (it is not in this account). */
  count: number
  /** The exact returned quantity (the reference's `total_amount`). */
  totalAmount: number
  currency: string
  totalPrice: number
}

export type ReturnRelease = {
  products: ReturnReleaseProduct[]
  orderReturns: number[]
  beginDate: string | null
  endDate: string | null
  agents: string[]
  deliveryMans: string[]
  clients: string[]
}

/** Employees' ids by display name ("Имя Фамилия"; the lowest id when two share a name). */
async function employeeIds(db: PgDb, names: string[]): Promise<Map<string, number>> {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  if (!wanted.length) return new Map()
  const rows = (await db
    .prepare(
      "SELECT btrim(concat_ws(' ', first_name, last_name)) AS name, MIN(id) AS id FROM employees WHERE btrim(concat_ws(' ', first_name, last_name)) = ANY(?::text[]) GROUP BY 1",
    )
    .all(wanted)) as Array<{ name: string; id: number | string }>
  return new Map(rows.map((row) => [row.name, Number(row.id)]))
}

type ReturnAccount = { id: number | null; deleted: boolean }

/** The client account each return is booked on, the way the returns list resolves it (the account Linko's card names
 * while the return is still on the same shop, else the return's own, else its shop's), with whether it was deleted. */
async function returnAccounts(db: PgDb, ids: number[]): Promise<Map<number, ReturnAccount>> {
  if (!ids.length) return new Map()
  const tables = (await db.prepare("SELECT to_regclass('financial_accounts') IS NOT NULL AND to_regclass('financial_account_markets') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!tables.ok) return new Map()
  const linko = `NULLIF(to_jsonb(r) ->> 'linko_account', '')::jsonb`
  const rows = (await db
    .prepare(
      `SELECT r.id AS return_id, a.account_id, COALESCE(NULLIF(to_jsonb(fa) ->> 'deleted', ''), '0') AS deleted
         FROM client_returns r
         LEFT JOIN clients c ON c.id = r.client_id
         CROSS JOIN LATERAL (SELECT COALESCE(
           CASE WHEN (${linko} ->> 'market')::int = r.client_id THEN (${linko} ->> 'id')::int END,
           NULLIF(to_jsonb(r) ->> 'financial_account_id', '')::int,
           (SELECT fm.financial_account_id FROM financial_account_markets fm WHERE fm.client_id = r.client_id ORDER BY fm.financial_account_id LIMIT 1),
           NULLIF(to_jsonb(c) ->> 'financial_account_id', '')::int) AS account_id) a
         LEFT JOIN financial_accounts fa ON fa.id = a.account_id
        WHERE r.id = ANY(?::int[])`,
    )
    .all(ids)) as Array<{ return_id: number; account_id: number | string | null; deleted: string }>
  return new Map(rows.map((row) => [row.return_id, { id: row.account_id === null ? null : Number(row.account_id), deleted: !["", "0", "false"].includes(row.deleted) }]))
}

/** Distinct names in the reference's order: by id (people by employee id, clients by account id), then the ones
 * without an id in the order they came. */
function byId(entries: Array<{ name: string; id: number | null | undefined }>): string[] {
  const seen = new Map<string, number>()
  for (const entry of entries) {
    const name = entry.name.trim()
    if (!name) continue
    const id = entry.id ?? Number.POSITIVE_INFINITY
    if (!seen.has(name) || id < (seen.get(name) as number)) seen.set(name, id)
  }
  return [...seen].map(([name, id], index) => ({ name, id, index })).sort((a, b) => a.id - b.id || a.index - b.index).map((entry) => entry.name)
}

/** The goods of the chosen returns summed per product and currency, with who and when (the reference's custom_release). */
export async function returnRelease(ids: number[]): Promise<ReturnRelease> {
  const rows = await loadReturns([...new Set(ids)].sort((a, b) => b - a))
  const db = getDb()
  const products = await productsOf(db, [...new Set(rows.flatMap((row) => (row.items ?? []).map((item) => item.productId)).filter((id): id is number => id !== null))])
  const lines = new Map<string, ReturnReleaseProduct>()
  for (const row of rows) {
    for (const item of row.items ?? []) {
      const key = `${item.productId ?? item.productName}\u0000${row.currency}`
      const product = item.productId === null ? undefined : products.get(item.productId)
      const line = lines.get(key) ?? {
        id: item.productId,
        name: item.productName,
        unit: item.unit || blank(product?.unit),
        type: blank(product?.type),
        barcodes: barcodesOf(product?.barcode),
        vendorCode: blank(product?.article),
        boxAmount: Number(product?.box_amount) || 0,
        boxUnit: blank(product?.box_unit),
        count: 0,
        totalAmount: 0,
        currency: row.currency,
        totalPrice: 0,
      }
      line.totalAmount = Math.round((line.totalAmount + item.quantity) * 1e9) / 1e9
      line.count = Math.trunc(line.totalAmount + 1e-9)
      line.totalPrice += item.total
      lines.set(key, line)
    }
  }
  const moments = rows.map(createdLocal).filter(Boolean).sort()
  // People in the reference's order (by user id): its «Агенты» / «Инициаторы» are the returns' creators.
  const people = await employeeIds(db, rows.flatMap((row) => [row.createdBy, row.deliverer]))
  const person = (name: string) => ({ name, id: people.get(name.trim()) })
  // Clients: the returns' client accounts by account id, without the accounts the reference has deleted.
  const accounts = await returnAccounts(
    db,
    rows.map((row) => row.id),
  )
  const clients = rows.flatMap((row) => {
    const account = accounts.get(row.id)
    return account?.deleted ? [] : [{ name: row.account || row.client, id: account?.id }]
  })
  return {
    // Products by product id, like the reference.
    products: [...lines.values()].sort((a, b) => (a.id ?? Number.POSITIVE_INFINITY) - (b.id ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name, "ru") || a.currency.localeCompare(b.currency)),
    orderReturns: rows.map((row) => row.id),
    beginDate: moments[0] ?? null,
    endDate: moments[moments.length - 1] ?? null,
    agents: byId(rows.map((row) => person(row.createdBy))),
    deliveryMans: byId(rows.map((row) => person(row.deliverer))),
    clients: byId(clients),
  }
}

/** "205-207", "205,207" or repeated ?ids= → ids; null when one is not a valid id or there are too many. */
export function parsePrintIds(values: string[]): number[] | null {
  const parts = values.flatMap((value) => value.split(/[-,\s]+/)).filter(Boolean)
  if (!parts.length || parts.length > MAX_PRINT_IDS) return null
  const ids: number[] = []
  for (const part of parts) {
    if (!/^\d{1,10}$/.test(part)) return null
    const id = Number(part)
    if (id <= 0 || id > 2_147_483_647) return null
    ids.push(id)
  }
  return [...new Set(ids)]
}
