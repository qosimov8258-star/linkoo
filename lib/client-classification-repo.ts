import "server-only"

import { classificationDynamic, pyRound } from "@/lib/classification-math"
import { loadRateBook } from "@/lib/currency-rates-repo"
import { getDb, outsideTransaction, withTransaction } from "@/lib/db"
import { baseReportCurrency, loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { ensureOrdersSchema } from "@/lib/orders-repo"
import { getSalesOptions } from "@/lib/sales-stats-repo"

// Data behind "Классификация и динамика клиентов" (demo: market/market_classification/stat). Every store
// falls into one bucket per period by the sum of its orders in that period, in the base currency (Валюты):
// each order is converted at the rate valid when it was created, and an order whose currency has no rate
// is left out. "Нет заказа" holds the stores without any. A bucket is `previous limit < sum <= limit`, the
// last one ("Больше") has no upper limit. "Дата создания" is the order's local (Tashkent) day.

export type ClassificationClass = { name: string; amount: number }
export type ClassificationPeriod = { from: string; to: string }
export type ClassificationParams = {
  closed: "not_closed" | "closed" | "all"
  statuses: number[]
  dateType: "date_delivery" | "created_date" | "accepted_time"
  periods: [ClassificationPeriod, ClassificationPeriod, ClassificationPeriod]
  classes: ClassificationClass[]
  zones?: string[]
  brands?: string[]
  productTypes?: string[]
  agents?: string[]
  branches?: string[]
  marketTypes?: string[]
}
export type ClassificationCell = { stores: number; storePercent: number; sum: number; sumPercent: number; dynamic?: number }
export type ClassificationRow = { name: string; periods: [ClassificationCell, ClassificationCell, ClassificationCell] }
export type ClassificationOptions = {
  zones: string[]
  brands: string[]
  productTypes: string[]
  agents: string[]
  branches: string[]
  marketTypes: string[]
  statuses: { id: number; name: string }[]
}

// the demo's order status ids, mapped to the status texts stored in `orders`
const STATUS_IDS: { id: number; name: string; local: string }[] = [
  { id: 0, name: "В процессе", local: "В процессе" },
  { id: 1, name: "Есть на складе", local: "Есть на складе" },
  { id: 2, name: "Передан доставщику", local: "В пути" },
  { id: 3, name: "Доставлен", local: "Доставлено" },
  { id: 5, name: "Не подтвержден", local: "Не подтвержден" },
]

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

// "18 авг. 2026" / "13 июля 2026" -> "2026-08-18"
function russianDate(value: string | null): string | null {
  if (!value) return null
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const ru = value.match(/(\d{1,2})\s+([а-яё]+)\.?\s+(\d{4})/i)
  if (!ru) return null
  const month = MONTHS.findIndex((name) => ru[2].toLowerCase().startsWith(name))
  if (month < 0) return null
  return `${ru[3]}-${String(month + 1).padStart(2, "0")}-${ru[1].padStart(2, "0")}`
}

/** The order's currency: its own column, else the code its amount text ends with ("" → the base). */
function currencyOf(order: OrderRow): string {
  if (order.currency?.trim()) return order.currency.trim()
  const match = String(order.amount ?? "").trim().match(/([A-Za-zА-Яа-я]+)\s*$/)
  return match?.[1] ?? ""
}

type OrderRow = {
  id: number
  client: string
  market_name: string
  status: string
  amount: string
  currency: string | null
  fact_price: number | null
  created_at: string
  /** Local (Tashkent) day of created_at, "YYYY-MM-DD". */
  created_day: string | null
  delivery: string | null
  accepted_date: string | null
}
type ItemRow = { order_id: number; quantity: number; unit_price: number; discount_percent: number | null; product_type: string | null; brand: string | null }

export async function getClassificationOptions(): Promise<ClassificationOptions> {
  const db = getDb()
  const sales = await getSalesOptions()
  const branches = ((await db.prepare("SELECT name FROM branches ORDER BY id").all()) as { name: string }[]).map((row) => row.name).filter(Boolean)
  return {
    zones: sales.zones,
    brands: sales.brands,
    productTypes: sales.productTypes,
    agents: sales.agents,
    branches,
    marketTypes: sales.marketTypes,
    statuses: STATUS_IDS.map(({ id, name }) => ({ id, name })),
  }
}

type Market = { id: number; name: string }

/** Everything the page's numbers come from: the stores in scope, and per period each store's orders and sum. */
async function loadClassification(params: ClassificationParams) {
  // The orders' currency column and the fin_* SQL helpers are installed by their modules (outside this request).
  await ensureOrdersSchema()
  await ensureFinanceSchema()
  const db = getDb()
  const has = (list: string[] | undefined): list is string[] => !!list && list.length > 0

  const clients = (await db
    .prepare("SELECT id, name, zone, agent, type, branch, tab FROM clients")
    .all()) as { id: number; name: string; zone: string; agent: string; type: string; branch: string; tab: string }[]
  const markets: Market[] = clients
    .filter((client) => {
      if (params.closed === "not_closed" && client.tab === "closing") return false
      if (params.closed === "closed" && client.tab !== "closing") return false
      if (has(params.zones) && !params.zones.includes(client.zone)) return false
      if (has(params.agents) && !params.agents.includes(client.agent)) return false
      if (has(params.branches) && !params.branches.includes(client.branch)) return false
      if (has(params.marketTypes) && !params.marketTypes.includes(client.type)) return false
      return true
    })
    .map((client) => ({ id: Number(client.id), name: client.name }))
  const marketNames = new Set(markets.map((client) => client.name))

  const localStatuses = STATUS_IDS.filter((item) => params.statuses.includes(item.id)).map((item) => item.local)
  const orders = localStatuses.length
    ? ((await db
        .prepare(
          `SELECT id, client, market_name, status, amount, currency, fact_price, created_at,
                  to_char(fin_ts(created_at, true)::date, 'YYYY-MM-DD') AS created_day, delivery, accepted_date FROM orders
           WHERE status IN (${localStatuses.map(() => "?").join(",")}) ORDER BY id`,
        )
        .all(...localStatuses)) as OrderRow[])
    : []

  const itemFilter = has(params.brands) || has(params.productTypes)
  const itemsByOrder = new Map<number, ItemRow[]>()
  if (itemFilter && orders.length) {
    const items = (await db
      .prepare(
        `SELECT i.order_id, i.quantity, i.unit_price, i.discount_percent, p.type AS product_type, p.brand AS brand
         FROM order_items i LEFT JOIN products p ON p.id = i.product_id
         WHERE i.order_id IN (${orders.map(() => "?").join(",")})`,
      )
      .all(...orders.map((order) => order.id))) as ItemRow[]
    for (const item of items) {
      if (has(params.brands) && !params.brands.includes(item.brand ?? "")) continue
      if (has(params.productTypes) && !params.productTypes.includes(item.product_type ?? "")) continue
      itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item])
    }
  }

  // Rates of Валюты (by id, with their history); the base currency is 1. A currency without a rate counts 0.
  const book = await loadRateBook(db)
  // The class limits are typed in the app currency when one is chosen (Настройки → Валюта приложения): sums are in it.
  const shown = baseReportCurrency(await loadCurrencyContext(db))
  const rateAt = (code: string, createdAt: string) => (book.rateAt(normCurrency(code, book.base), createdAt) ?? 0) * shown.factor

  // Linko's total_sale is the order total less its returns: the order's total_return_price (its accepted returns,
  // already out of fact_price here), and when that is 0, its cancelled return documents instead (a Linko quirk).
  // Checked against the reference's market_classification/stat and get_markets: orders 508, 1043, 1108, 1232, 1257
  // and 1484 lose their cancelled return, 1216, 1357 and 1493 (with an accepted one) do not; pending ones never count.
  const otherReturns = new Map<number, { amount: number; currency: string }[]>()
  if (!itemFilter && orders.length) {
    const rows = (await db
      .prepare(
        `SELECT order_id, amount, currency FROM client_returns r
         WHERE order_id IS NOT NULL AND status = 'cancelled'
           AND NOT EXISTS (SELECT 1 FROM client_returns a WHERE a.order_id = r.order_id AND a.status = 'accepted')`,
      )
      .all()) as { order_id: number; amount: number | string; currency: string | null }[]
    for (const row of rows) {
      const id = Number(row.order_id)
      otherReturns.set(id, [...(otherReturns.get(id) ?? []), { amount: Number(row.amount) || 0, currency: row.currency ?? "" }])
    }
  }

  const dateOf = (order: OrderRow) =>
    params.dateType === "created_date" ? order.created_day : params.dateType === "accepted_time" ? russianDate(order.accepted_date) : russianDate(order.delivery)
  const saleOf = (order: OrderRow) => {
    const rate = rateAt(currencyOf(order), order.created_at)
    if (itemFilter) {
      const sum = (itemsByOrder.get(order.id) ?? []).reduce((total, item) => total + item.quantity * item.unit_price * (1 - (item.discount_percent ?? 0) / 100), 0)
      return sum * rate
    }
    const own = order.fact_price ?? (Number.parseFloat(order.amount.replace(/[^\d.,-]/g, "").replace(/\s/g, "").replace(",", ".")) || 0)
    const returned = (otherReturns.get(order.id) ?? []).reduce((total, ret) => total + ret.amount * (ret.currency ? rateAt(ret.currency, order.created_at) : rate), 0)
    return own * rate - returned
  }

  const classes = [...params.classes].sort((a, b) => a.amount - b.amount)
  const names = ["Нет заказа", ...classes.map((item) => item.name), "Больше"]
  const bucketOf = (total: number) => {
    if (total <= 0) return 0
    const index = classes.findIndex((item) => total <= item.amount)
    return index === -1 ? classes.length + 1 : index + 1
  }

  // Per period: each store (by name, as orders name it) → its orders of the period and their sum.
  const perPeriod = params.periods.map((period) => {
    const byName = new Map<string, { sale: number; orders: OrderRow[] }>()
    for (const order of orders) {
      const day = dateOf(order)
      if (!day || day < period.from || day > period.to) continue
      const name = order.market_name || order.client
      if (!marketNames.has(name)) continue
      if (itemFilter && !itemsByOrder.has(order.id)) continue
      const entry = byName.get(name) ?? { sale: 0, orders: [] }
      entry.sale += saleOf(order)
      entry.orders.push(order)
      byName.set(name, entry)
    }
    return byName
  })

  return { db, markets, names, bucketOf, perPeriod, rateAt, itemFilter, itemsByOrder }
}

export async function getClassification(params: ClassificationParams): Promise<ClassificationRow[]> {
  const { markets, names, bucketOf, perPeriod } = await loadClassification(params)
  const cells = perPeriod.map((byName) => {
    const buckets = names.map(() => ({ stores: 0, sum: 0 }))
    for (const client of markets) {
      const total = byName.get(client.name)?.sale ?? 0
      const bucket = buckets[bucketOf(total)]
      bucket.stores += 1
      bucket.sum += total
    }
    const storeTotal = markets.length || 1
    const sumTotal = buckets.reduce((sum, bucket) => sum + bucket.sum, 0) || 1
    return buckets.map((bucket) => ({
      stores: bucket.stores,
      storePercent: pyRound((bucket.stores / storeTotal) * 100),
      sum: bucket.sum,
      sumPercent: pyRound((bucket.sum / sumTotal) * 100),
    }))
  })

  return names.map((name, index) => ({
    name,
    periods: [
      cells[0][index],
      { ...cells[1][index], dynamic: classificationDynamic(cells[1][index].stores, cells[0][index].stores) },
      { ...cells[2][index], dynamic: classificationDynamic(cells[2][index].stores, cells[1][index].stores) },
    ],
  }))
}

export type ClassificationMarketCell = { sale: number; sku: number; visits: number; successVisits: number }
export type ClassificationMarket = { id: number; name: string; periods: [ClassificationMarketCell, ClassificationMarketCell, ClassificationMarketCell] }

async function productIdsByOrder(db: Awaited<ReturnType<typeof loadClassification>>["db"], orderIds: number[]) {
  const map = new Map<number, ProductLine[]>()
  if (!orderIds.length) return map
  // return_quantity is added by the order items module (lib/order-items-repo.ts): read it without depending on it.
  const rows = (await db
    .prepare(
      `SELECT i.order_id, i.product_id, i.quantity - COALESCE((to_jsonb(i) ->> 'return_quantity')::double precision, 0) AS quantity, i.unit_price, i.discount_percent, COALESCE(p.name, i.product_name, '') AS name,
              COALESCE(p.type, '') AS product_type, COALESCE(p.brand, '') AS brand
       FROM order_items i LEFT JOIN products p ON p.id = i.product_id
       WHERE i.order_id IN (${orderIds.map(() => "?").join(",")})`,
    )
    .all(...orderIds)) as ProductLine[]
  for (const row of rows) map.set(Number(row.order_id), [...(map.get(Number(row.order_id)) ?? []), row])
  return map
}
type ProductLine = { order_id: number; product_id: number | null; quantity: number; unit_price: number; discount_percent: number | null; name: string; product_type: string; brand: string }

/** Linko's list under the table (market_classification/get_markets): the stores of class `bucket` (0 = «Нет заказа»,
 * then the classes, then «Больше») in period `period`, with their sale, assortment (distinct products ordered),
 * visits and successful visits (ended with an order) in each of the three periods. Newest store first. */
export async function getClassificationMarkets(params: ClassificationParams, period: 0 | 1 | 2, bucket: number): Promise<ClassificationMarket[]> {
  const { db, markets, bucketOf, perPeriod } = await loadClassification(params)
  const chosen = markets.filter((market) => bucketOf(perPeriod[period].get(market.name)?.sale ?? 0) === bucket).sort((a, b) => b.id - a.id)
  if (!chosen.length) return []
  const orderIds = chosen.flatMap((market) => perPeriod.flatMap((byName) => (byName.get(market.name)?.orders ?? []).map((order) => order.id)))
  const lines = await productIdsByOrder(db, orderIds)
  const visits = await visitCounts(db, chosen.map((market) => market.id), params.periods)
  return chosen.map((market) => ({
    id: market.id,
    name: market.name,
    periods: perPeriod.map((byName, index) => {
      const entry = byName.get(market.name)
      const products = new Set<string>()
      for (const order of entry?.orders ?? []) for (const line of lines.get(order.id) ?? []) products.add(line.product_id ? `id:${line.product_id}` : `name:${line.name}`)
      const counted = visits.get(`${market.id}:${index}`) ?? { visits: 0, success: 0 }
      return { sale: entry?.sale ?? 0, sku: products.size, visits: counted.visits, successVisits: counted.success }
    }) as ClassificationMarket["periods"],
  }))
}

/** The agents' visits of each store per period (by the local day of the check-in); successful = ended with an order. */
async function visitCounts(db: Awaited<ReturnType<typeof loadClassification>>["db"], ids: number[], periods: ClassificationParams["periods"]) {
  const out = new Map<string, { visits: number; success: number }>()
  const exists = (await db.prepare("SELECT to_regclass('public.field_visits') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!exists?.ok || !ids.length) return out
  for (const [index, period] of periods.entries()) {
    const rows = (await db
      .prepare(
        `SELECT client_id, COUNT(*)::int AS visits, COUNT(*) FILTER (WHERE result = 'order')::int AS success FROM field_visits
         WHERE client_id = ANY(?::int[]) AND (started_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN ?::date AND ?::date
         GROUP BY client_id`,
      )
      .all(ids, period.from, period.to)) as { client_id: number; visits: number; success: number }[]
    for (const row of rows) out.set(`${row.client_id}:${index}`, { visits: Number(row.visits), success: Number(row.success) })
  }
  return out
}

export type ClassificationProductRow = { key: string; name: string; values: [number, number, number]; dynamics: [number, number] }

/** Linko's «Ассортимент» window (market_classification/get_products): what one store bought in each period, by
 * product, product type or brand, as quantity («Кол-во») or sum («Сумма», in the page's currency). */
export async function getClassificationProducts(
  params: ClassificationParams,
  marketId: number,
  groupBy: "product" | "product_type" | "brand",
  countType: "amount" | "sum",
): Promise<ClassificationProductRow[]> {
  const { db, markets, perPeriod, rateAt } = await loadClassification(params)
  const market = markets.find((item) => item.id === marketId)
  if (!market) return []
  const ordersOf = perPeriod.map((byName) => byName.get(market.name)?.orders ?? [])
  const lines = await productIdsByOrder(db, ordersOf.flat().map((order) => order.id))
  const groups = new Map<string, { key: string; name: string; order: number; values: [number, number, number] }>()
  ordersOf.forEach((orders, index) => {
    for (const order of orders) {
      const rate = countType === "sum" ? rateAt(currencyOf(order), order.created_at) : 1
      for (const line of lines.get(order.id) ?? []) {
        const name = groupBy === "product" ? line.name : groupBy === "product_type" ? line.product_type : line.brand
        if (groupBy !== "product" && !name) continue
        const key = groupBy === "product" && line.product_id ? `id:${line.product_id}` : `name:${name}`
        const value = countType === "amount" ? Number(line.quantity) || 0 : (Number(line.quantity) || 0) * (Number(line.unit_price) || 0) * (1 - (Number(line.discount_percent) || 0) / 100) * rate
        const group = groups.get(key) ?? { key, name, order: groupBy === "product" && line.product_id ? Number(line.product_id) : 0, values: [0, 0, 0] as [number, number, number] }
        group.values[index] += value
        groups.set(key, group)
      }
    }
  })
  return [...groups.values()]
    .sort((a, b) => b.order - a.order || a.name.localeCompare(b.name, "ru"))
    .map((group) => ({
      key: group.key,
      name: group.name,
      values: group.values,
      dynamics: [classificationDynamic(group.values[1], group.values[0]), classificationDynamic(group.values[2], group.values[1])],
    }))
}

// The classes of "Настроить классификацию" are kept on the server (the demo: market/market_classification/).
const DEFAULT_CLASSES: ClassificationClass[] = [
  { name: "< 1 млн", amount: 1_000_000 },
  { name: "1-2 млн", amount: 2_000_000 },
  { name: "2-3 млн", amount: 3_000_000 },
  { name: "3-5 млн", amount: 5_000_000 },
  { name: "5-10 млн", amount: 10_000_000 },
  { name: "10-20 млн", amount: 20_000_000 },
]

declare global {
  var __linkoClassificationClassesSchema: Promise<void> | undefined
}

/** The classes table (and the default classes of an empty one): once per process, on the maintenance
 * pool (outsideTransaction), never inside a request transaction. */
function ensureClassesSchema(): Promise<void> {
  globalThis.__linkoClassificationClassesSchema ??= outsideTransaction(() =>
    withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:client_classification_classes'))")
      await tx.exec("CREATE TABLE IF NOT EXISTS client_classification_classes (id SERIAL PRIMARY KEY, name TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL)")
      const count = (await tx.prepare("SELECT COUNT(*) AS n FROM client_classification_classes").get()) as { n: number | string }
      if (Number(count.n) === 0) {
        for (const item of DEFAULT_CLASSES) await tx.prepare("INSERT INTO client_classification_classes (name, amount) VALUES (?, ?)").run(item.name, item.amount)
      }
    }),
  ).catch((error: unknown) => {
    globalThis.__linkoClassificationClassesSchema = undefined
    throw error
  })
  return globalThis.__linkoClassificationClassesSchema
}

export async function getClassificationClasses(): Promise<ClassificationClass[]> {
  await ensureClassesSchema()
  const db = getDb()
  const rows = (await db.prepare("SELECT name, amount FROM client_classification_classes ORDER BY amount, id").all()) as { name: string; amount: number }[]
  return rows.map((row) => ({ name: row.name, amount: Number(row.amount) }))
}

/** Replaces the set of classes (the settings dialog saves the whole list). */
export async function saveClassificationClasses(classes: ClassificationClass[]): Promise<ClassificationClass[]> {
  await ensureClassesSchema()
  // One transaction, serialised: two parallel saves never leave both lists mixed.
  await withTransaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:client_classification_classes'))")
    await tx.exec("DELETE FROM client_classification_classes")
    for (const item of [...classes].sort((a, b) => a.amount - b.amount)) {
      await tx.prepare("INSERT INTO client_classification_classes (name, amount) VALUES (?, ?)").run(item.name, item.amount)
    }
  })
  return getClassificationClasses()
}
