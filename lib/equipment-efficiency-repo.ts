import "server-only"

import { allocatedOrderDues } from "@/lib/cash/orders"
import { ensureCashSchema } from "@/lib/cash/schema"
import { listClientTypes } from "@/lib/client-types-repo"
import { loadRateBook } from "@/lib/currency-rates-repo"
import { getDb } from "@/lib/db"
import { baseReportCurrency, loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { ensureInventorySchema } from "@/lib/inventory-items-schema"
import { ensureOrdersSchema } from "@/lib/orders-repo"

// «Эффективность оборудования» (Linko #/statistics/gear, API stats/client_gear/ and stats/client_gear/total/): the
// clients that hold equipment (Работа с инвентарем: inventory_items placed at a client) and what they bought in a
// period. Rules, checked against Linko's API for a day, a month, a year and every filter (2026-11-20):
// - an order counts when it is not cancelled and was created in the period (its Tashkent day); «Период по дате
//   реализации» also needs its delivery day (orders.accepted_date) in that range; «Организация инвентаря» keeps the
//   orders of that organization;
// - Факт. продажи = the orders' fact price (total less returns). Linko adds the raw numbers of every currency (a
//   client's 200 000 SUM + 11,7088 USD print as 200 011,7088 SUM); here each order is converted at the rate valid when
//   it was created, into the app currency when one is chosen, like the other sales reports;
// - Разновидности = distinct products of those orders, Кол-во продуктов = their quantity less returns (with an
//   organization filter, only the products of that organization);
// - Факт. продажи оборудования = Факт. продажи / the client's equipment count;
// - client filters (agent, zone, branch, client type) narrow the clients and every total; the equipment filters
//   (Инвентарь, Тип инвентаря), the sales ranges and the search only narrow the list and its equipment totals;
//   «Организация инвентаря» keeps the equipment whose product belongs to it;
// - ОКБ = the clients, АКБ = those with a counted order; АКБ с оборудованием = listed clients with sales above 0;
//   Средний чек одного оборудования = their sales / every equipment of the filtered clients;
// - the sales groups: up to the first limit (zero included), up to the second, above it.
// Linko's «Продукт» / «Тип товара заказа» filters only narrow the orders window of a client, as here.

export type GearFilters = {
  from: string
  to: string
  acceptedFrom?: string
  acceptedTo?: string
  agents?: number[]
  divisions?: number[]
  zones?: number[]
  branches?: number[]
  gears?: number[]
  gearProducts?: number[]
  clientTypes?: number[]
  products?: number[]
  productTypes?: number[]
  factFrom?: number | null
  factTo?: number | null
  factByGearFrom?: number | null
  factByGearTo?: number | null
  search?: string
  ordering?: string
  firstLimit?: number
  secondLimit?: number
}

export type GearRow = {
  id: number
  name: string
  totalSales: number
  totalSalesByGear: number
  productCount: number
  productAmount: number
  /** The client's equipment, newest first (Linko's gears list). */
  gears: { id: number; productId: number | null; productName: string }[]
}

export type GearTotal = {
  okb: number
  okbGear: number
  akb: number
  akbGear: number
  avgCheck: number
  firstAmount: number
  secondAmount: number
  thirdAmount: number
  totalFact: number
  totalFactGear: number
  okbGearCount: number
  akbGearCount: number
  firstGearCount: number
  secondGearCount: number
  thirdGearCount: number
  currency: string
}

export type GearReport = { rows: GearRow[]; total: GearTotal }

export type GearOption = { id: number; name: string; parentId?: number | null }
export type GearOptions = {
  agents: GearOption[]
  divisions: GearOption[]
  zones: GearOption[]
  branches: GearOption[]
  gears: GearOption[]
  gearProducts: GearOption[]
  clientTypes: GearOption[]
  products: GearOption[]
  productTypes: GearOption[]
}

export type GearOrder = {
  id: number
  paymentDate: string
  paymentType: string
  totalPrice: number
  remaining: number
  currency: string
  status: string
}

/** Linko's default limits of the sales groups (FIRST_AMOUNT_DEFAULT / SECOND_AMOUNT_DEFAULT). */
export const GEAR_FIRST_LIMIT = 1_500_000
export const GEAR_SECOND_LIMIT = 3_000_000

const has = (list: number[] | undefined): list is number[] => Array.isArray(list) && list.length > 0
const num = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

type ClientRow = { id: number; name: string; agent: string; zone: string; branch: string; type: string }
type GearItemRow = { id: number; client_id: number; product_id: number | null; product_name: string | null; organization: string | null }
type OrderRow = { id: number; client_id: number; currency: string; fact: number | string | null; created_at: string }
type ItemRow = { order_id: number; product_id: number | null; quantity: number | string; return_quantity: number | string; organization: string | null }

/** Names of the directory rows `ids` (the clients and products keep names, not ids). */
async function namesOf(sql: string, ids: number[]): Promise<Set<string>> {
  const rows = (await getDb().prepare(sql).all({ ids })) as { name: string | null }[]
  return new Set(rows.map((row) => (row.name ?? "").trim()).filter(Boolean))
}

/** The client types `ids` and their sub-types (Linko's «Тип клиента» with its «Подкатегория»). */
async function clientTypeNames(ids: number[]): Promise<Set<string>> {
  const wanted = new Set(ids)
  return new Set((await listClientTypes()).filter((type) => wanted.has(type.id) || (type.parentId !== null && wanted.has(type.parentId))).map((type) => type.name.trim()))
}

/** Orders counted for the period and the order filters, with their fact price. */
function orderSql(filters: GearFilters): { sql: string; params: Record<string, unknown> } {
  const where = ["o.status <> 'Отменен'", "o.client_id IS NOT NULL", "fin_ts(o.created_at, true)::date BETWEEN @from::date AND @to::date"]
  const params: Record<string, unknown> = { from: filters.from, to: filters.to }
  if (filters.acceptedFrom && filters.acceptedTo) {
    where.push("o.accepted_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND left(o.accepted_date, 10) BETWEEN @acceptedFrom AND @acceptedTo")
    params.acceptedFrom = filters.acceptedFrom
    params.acceptedTo = filters.acceptedTo
  }
  if (has(filters.divisions)) {
    where.push("o.organization_id = ANY(@divisions::int[])")
    params.divisions = filters.divisions
  }
  return {
    sql: `SELECT o.id, o.client_id, o.currency, COALESCE(o.fact_price, COALESCE(o.total_price, 0) - COALESCE(o.return_price, 0)) AS fact, o.created_at
          FROM orders o WHERE ${where.join(" AND ")}`,
    params,
  }
}

export async function getEquipmentEfficiency(filters: GearFilters): Promise<GearReport> {
  const db = getDb()
  await Promise.all([ensureOrdersSchema(), ensureInventorySchema()])
  await ensureFinanceSchema(db)

  // Client filters (names: the clients table keeps the agent, zone, branch and type by name).
  const agentNames = has(filters.agents)
    ? await namesOf("SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name FROM employees WHERE id = ANY(@ids::int[])", filters.agents)
    : null
  const zoneNames = has(filters.zones) ? await namesOf("SELECT name FROM client_zones WHERE id = ANY(@ids::int[])", filters.zones) : null
  const branchNames = has(filters.branches) ? await namesOf("SELECT name FROM branches WHERE id = ANY(@ids::int[])", filters.branches) : null
  const typeNames = has(filters.clientTypes) ? await clientTypeNames(filters.clientTypes) : null
  const divisionNames = has(filters.divisions) ? await namesOf("SELECT name FROM organizations WHERE id = ANY(@ids::int[])", filters.divisions) : null

  const clients = ((await db.prepare("SELECT id, name, agent, zone, branch, type FROM clients ORDER BY id").all()) as ClientRow[]).filter((client) => {
    if (agentNames && !agentNames.has((client.agent ?? "").trim())) return false
    if (zoneNames && !zoneNames.has((client.zone ?? "").trim())) return false
    if (branchNames && !branchNames.has((client.branch ?? "").trim())) return false
    if (typeNames && !typeNames.has((client.type ?? "").trim())) return false
    return true
  })
  const clientById = new Map(clients.map((client) => [Number(client.id), client]))

  // Every counted order of the period, in the shown currency (each at the rate of its creation).
  const book = await loadRateBook(db)
  const shown = baseReportCurrency(await loadCurrencyContext(db))
  const { sql, params } = orderSql(filters)
  const orders = ((await db.prepare(sql).all(params)) as OrderRow[]).filter((order) => clientById.has(Number(order.client_id)))
  const salesOf = new Map<number, number>()
  let totalFact = 0
  for (const order of orders) {
    const rate = (book.rateAt(normCurrency(order.currency, book.base), order.created_at) ?? 0) * shown.factor
    const amount = num(order.fact) * rate
    totalFact += amount
    salesOf.set(Number(order.client_id), (salesOf.get(Number(order.client_id)) ?? 0) + amount)
  }
  const activeClients = new Set(orders.map((order) => Number(order.client_id)))

  // The equipment placed at the filtered clients, newest first. With «Организация инвентаря» a client is listed when
  // one of its equipment's products belongs to it and only that equipment is counted in the totals, while its row
  // still names all of its equipment (as Linko's list does).
  const items = ((await db
    .prepare(
      `SELECT i.id, i.client_id, i.product_id, COALESCE(NULLIF(btrim(p.name), ''), NULLIF(btrim(i.inventory_type), ''), '') AS product_name, p.organization
       FROM inventory_items i LEFT JOIN products p ON p.id = i.product_id
       WHERE i.deleted = 0 AND i.client_id IS NOT NULL ORDER BY i.id DESC`,
    )
    .all()) as GearItemRow[]).filter((item) => clientById.has(Number(item.client_id)))
  const gearsOf = new Map<number, GearRow["gears"]>()
  const countedOf = new Map<number, number>()
  for (const item of items) {
    const clientId = Number(item.client_id)
    const list = gearsOf.get(clientId) ?? []
    list.push({ id: Number(item.id), productId: item.product_id === null ? null : Number(item.product_id), productName: item.product_name ?? "" })
    gearsOf.set(clientId, list)
    if (!divisionNames || divisionNames.has((item.organization ?? "").trim())) countedOf.set(clientId, (countedOf.get(clientId) ?? 0) + 1)
  }
  for (const clientId of [...gearsOf.keys()]) if (!countedOf.has(clientId)) gearsOf.delete(clientId)
  const allGearCount = [...countedOf.values()].reduce((sum, count) => sum + count, 0)

  // Products of the equipment clients' orders.
  const gearClientIds = new Set(gearsOf.keys())
  const gearOrderIds = orders.filter((order) => gearClientIds.has(Number(order.client_id))).map((order) => Number(order.id))
  const clientOfOrder = new Map(orders.map((order) => [Number(order.id), Number(order.client_id)]))
  const productsOf = new Map<number, { ids: Set<number>; amount: number }>()
  if (gearOrderIds.length) {
    const lines = (await db
      .prepare(
        `SELECT oi.order_id, oi.product_id, oi.quantity, oi.return_quantity, p.organization
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ANY(@ids::int[])`,
      )
      .all({ ids: gearOrderIds })) as ItemRow[]
    for (const line of lines) {
      if (divisionNames && !divisionNames.has((line.organization ?? "").trim())) continue
      const clientId = clientOfOrder.get(Number(line.order_id))
      if (clientId === undefined) continue
      const entry = productsOf.get(clientId) ?? { ids: new Set<number>(), amount: 0 }
      if (line.product_id !== null) entry.ids.add(Number(line.product_id))
      entry.amount += num(line.quantity) - num(line.return_quantity)
      productsOf.set(clientId, entry)
    }
  }

  const gearIds = has(filters.gears) ? new Set(filters.gears) : null
  const gearProducts = has(filters.gearProducts) ? new Set(filters.gearProducts) : null
  const inRange = (value: number, from?: number | null, to?: number | null) => (from == null || value >= from) && (to == null || value <= to)

  let rows: GearRow[] = []
  for (const [clientId, gears] of gearsOf) {
    if (gearIds && !gears.some((gear) => gearIds.has(gear.id))) continue
    if (gearProducts && !gears.some((gear) => gear.productId !== null && gearProducts.has(gear.productId))) continue
    const totalSales = salesOf.get(clientId) ?? 0
    const totalSalesByGear = totalSales / gears.length
    if (!inRange(totalSales, filters.factFrom, filters.factTo)) continue
    if (!inRange(totalSalesByGear, filters.factByGearFrom, filters.factByGearTo)) continue
    const products = productsOf.get(clientId)
    rows.push({
      id: clientId,
      name: clientById.get(clientId)?.name ?? "",
      totalSales,
      totalSalesByGear,
      productCount: products?.ids.size ?? 0,
      productAmount: products?.amount ?? 0,
      gears,
    })
  }

  // Totals over the listed clients (the search narrows the list only, like Linko's).
  const firstLimit = filters.firstLimit ?? GEAR_FIRST_LIMIT
  const secondLimit = filters.secondLimit ?? GEAR_SECOND_LIMIT
  const total: GearTotal = {
    okb: clients.length,
    okbGear: rows.length,
    akb: activeClients.size,
    akbGear: 0,
    avgCheck: 0,
    firstAmount: 0,
    secondAmount: 0,
    thirdAmount: 0,
    totalFact,
    totalFactGear: 0,
    okbGearCount: 0,
    akbGearCount: 0,
    firstGearCount: 0,
    secondGearCount: 0,
    thirdGearCount: 0,
    currency: shown.code,
  }
  for (const row of rows) {
    const count = countedOf.get(row.id) ?? 0
    total.okbGearCount += count
    total.totalFactGear += row.totalSales
    if (row.totalSales > 0) {
      total.akbGear += 1
      total.akbGearCount += count
    }
    if (row.totalSales <= firstLimit) {
      total.firstAmount += 1
      total.firstGearCount += count
    } else if (row.totalSales <= secondLimit) {
      total.secondAmount += 1
      total.secondGearCount += count
    } else {
      total.thirdAmount += 1
      total.thirdGearCount += count
    }
  }
  total.avgCheck = allGearCount ? total.totalFactGear / allGearCount : 0

  const term = (filters.search ?? "").trim().toLocaleLowerCase("ru")
  if (term) rows = rows.filter((row) => row.name.toLocaleLowerCase("ru").includes(term))
  // Linko lists the clients by id; «Факт. продажи» and «Факт. продажи оборудования» sort both ways.
  const ordering = filters.ordering ?? ""
  const key = ordering.replace(/^-/, "")
  if (key === "totalSales" || key === "totalSalesByGear") {
    const sign = ordering.startsWith("-") ? -1 : 1
    rows.sort((a, b) => sign * (a[key] - b[key]) || a.id - b.id)
  } else {
    rows.sort((a, b) => a.id - b.id)
  }
  return { rows, total }
}

/** The orders window of a client (Linko's sales/order/?market=…&exclude_cancelled=true): its counted orders of the
 * period, newest first, with what is left to pay (the cash ledger's figure, as the orders list shows it). */
export async function getEquipmentClientOrders(clientId: number, filters: GearFilters): Promise<GearOrder[]> {
  const db = getDb()
  await ensureOrdersSchema()
  await ensureFinanceSchema(db)
  const { sql, params } = orderSql(filters)
  const where: string[] = ["x.client_id = @clientId"]
  const all: Record<string, unknown> = { ...params, clientId }
  if (has(filters.products)) {
    where.push("EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = x.id AND oi.product_id = ANY(@products::int[]))")
    all.products = filters.products
  }
  if (has(filters.productTypes)) {
    const typeNames = [...(await namesOf("SELECT name FROM product_types WHERE id = ANY(@ids::int[]) OR parent_id = ANY(@ids::int[])", filters.productTypes))]
    where.push("EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = x.id AND btrim(p.type) = ANY(@types::text[]))")
    all.types = typeNames
  }
  const rows = (await db
    .prepare(
      `SELECT o.id, o.payment_date, o.payment_type, o.pay_method, o.total_price, o.currency, o.status
       FROM (${sql}) x JOIN orders o ON o.id = x.id WHERE ${where.join(" AND ")} ORDER BY o.id DESC`,
    )
    .all(all)) as { id: number; payment_date: string; payment_type: string; pay_method: string; total_price: number | null; currency: string; status: string }[]
  if (!rows.length) return []
  await ensureCashSchema(db)
  const context = await loadCurrencyContext(db)
  const dues = new Map((await allocatedOrderDues(db, rows.map((row) => Number(row.id)), context)).map((due) => [due.id, due]))
  return rows.map((row) => {
    const currency = normCurrency(row.currency, context.base)
    const due = dues.get(Number(row.id))
    const part = due?.currencies.find((entry) => normCurrency(entry.currency, context.base) === currency)
    return {
      id: Number(row.id),
      paymentDate: row.payment_date ?? "",
      paymentType: (row.payment_type || row.pay_method || "").trim(),
      totalPrice: num(row.total_price),
      remaining: part ? Math.max(0, part.remaining) : 0,
      currency,
      status: row.status,
    }
  })
}

/** The option lists of the filter panel (ids are Linko's, as the copied directories keep them). */
export async function getEquipmentOptions(): Promise<GearOptions> {
  const db = getDb()
  await ensureInventorySchema()
  const list = async (sql: string) =>
    ((await db.prepare(sql).all()) as { id: number; name: string | null; parent_id?: number | null }[])
      .map((row) => ({ id: Number(row.id), name: (row.name ?? "").trim(), parentId: row.parent_id == null ? null : Number(row.parent_id) }))
      .filter((row) => row.name)
  const [agents, divisions, zones, branches, gears, gearProducts, clientTypes, products, productTypes] = await Promise.all([
    list("SELECT id, TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name FROM employees WHERE active = 1 ORDER BY id"),
    list("SELECT id, name FROM organizations ORDER BY name, id"),
    list("SELECT id, name FROM client_zones ORDER BY name, id"),
    list("SELECT id, name FROM branches ORDER BY id"),
    list(
      `SELECT i.id, COALESCE(NULLIF(btrim(p.name), ''), btrim(i.inventory_type)) || '   (№' || COALESCE(NULLIF(btrim(i.inventory_code), ''), '') || ')' AS name
       FROM inventory_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.deleted = 0 ORDER BY i.id DESC`,
    ),
    list("SELECT id, name FROM products WHERE is_inventory = 1 AND deleted = 0 ORDER BY id DESC"),
    listClientTypes().then((types) => types.map((type) => ({ id: type.id, name: type.name.trim(), parentId: type.parentId })).filter((type) => type.name)),
    list("SELECT id, name FROM products WHERE deleted = 0 ORDER BY id DESC"),
    list("SELECT id, name, parent_id FROM product_types ORDER BY name, id"),
  ])
  return { agents, divisions, zones, branches, gears, gearProducts, clientTypes, products, productTypes }
}
