import "server-only"

import { getDb } from "@/lib/db"
import { getSalesOptions } from "@/lib/sales-stats-repo"

// Data behind "Классификация и динамика клиентов" (demo: market/market_classification/stat). Every store
// falls into one bucket per period by the SUM of its orders in that period; "Нет заказа" holds the stores
// without any. A bucket is `previous limit < sum <= limit`, the last one ("Больше") has no upper limit.

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

function currencyOf(amount: string) {
  const match = amount.trim().match(/([A-Za-zА-Яа-я]+)\s*$/)
  return (match?.[1] ?? "SUM").toUpperCase()
}

type OrderRow = {
  id: number
  client: string
  market_name: string
  status: string
  amount: string
  fact_price: number | null
  created_at: string
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

export async function getClassification(params: ClassificationParams): Promise<ClassificationRow[]> {
  const db = getDb()
  const has = (list: string[] | undefined): list is string[] => !!list && list.length > 0

  const clients = (await db
    .prepare("SELECT name, zone, agent, type, branch, tab FROM clients")
    .all()) as { name: string; zone: string; agent: string; type: string; branch: string; tab: string }[]
  const markets = clients.filter((client) => {
    if (params.closed === "not_closed" && client.tab === "closing") return false
    if (params.closed === "closed" && client.tab !== "closing") return false
    if (has(params.zones) && !params.zones.includes(client.zone)) return false
    if (has(params.agents) && !params.agents.includes(client.agent)) return false
    if (has(params.branches) && !params.branches.includes(client.branch)) return false
    if (has(params.marketTypes) && !params.marketTypes.includes(client.type)) return false
    return true
  })
  const marketNames = new Set(markets.map((client) => client.name))

  const localStatuses = STATUS_IDS.filter((item) => params.statuses.includes(item.id)).map((item) => item.local)
  const orders = localStatuses.length
    ? ((await db
        .prepare(
          `SELECT id, client, market_name, status, amount, fact_price, created_at, delivery, accepted_date FROM orders
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

  const currencies = (await db.prepare("SELECT id, name, rate FROM currencies").all()) as { id: number; name: string; rate: number }[]
  const rateRows = (await db.prepare("SELECT currency_id, rate, created_at FROM currency_rates ORDER BY created_at").all()) as {
    currency_id: number
    rate: number
    created_at: string
  }[]
  const rateAt = (code: string, createdAt: string) => {
    const currency = currencies.find((item) => item.name.toUpperCase() === code)
    if (!currency || currency.rate === 1) return 1
    let rate = 0
    for (const row of rateRows) if (row.currency_id === currency.id && row.created_at <= createdAt) rate = row.rate
    return rate || currency.rate
  }

  const dateOf = (order: OrderRow) =>
    params.dateType === "created_date" ? order.created_at.slice(0, 10) : params.dateType === "accepted_time" ? russianDate(order.accepted_date) : russianDate(order.delivery)
  const saleOf = (order: OrderRow) => {
    const rate = rateAt(currencyOf(order.amount), order.created_at)
    if (itemFilter) {
      const sum = (itemsByOrder.get(order.id) ?? []).reduce((total, item) => total + item.quantity * item.unit_price * (1 - (item.discount_percent ?? 0) / 100), 0)
      return sum * rate
    }
    const own = order.fact_price ?? (Number.parseFloat(order.amount.replace(/[^\d.,-]/g, "").replace(/\s/g, "").replace(",", ".")) || 0)
    return own * rate
  }

  const classes = [...params.classes].sort((a, b) => a.amount - b.amount)
  const names = ["Нет заказа", ...classes.map((item) => item.name), "Больше"]
  const bucketOf = (total: number) => {
    if (total <= 0) return 0
    const index = classes.findIndex((item) => total <= item.amount)
    return index === -1 ? classes.length + 1 : index + 1
  }

  const perPeriod = params.periods.map((period) => {
    const totals = new Map<string, number>()
    for (const order of orders) {
      const day = dateOf(order)
      if (!day || day < period.from || day > period.to) continue
      const name = order.market_name || order.client
      if (!marketNames.has(name)) continue
      if (itemFilter && !itemsByOrder.has(order.id)) continue
      totals.set(name, (totals.get(name) ?? 0) + saleOf(order))
    }
    const buckets = names.map(() => ({ stores: 0, sum: 0 }))
    for (const client of markets) {
      const total = totals.get(client.name) ?? 0
      const bucket = buckets[bucketOf(total)]
      bucket.stores += 1
      bucket.sum += total
    }
    const storeTotal = markets.length || 1
    const sumTotal = buckets.reduce((sum, bucket) => sum + bucket.sum, 0) || 1
    return buckets.map((bucket) => ({
      stores: bucket.stores,
      storePercent: Math.round((bucket.stores / storeTotal) * 100),
      sum: bucket.sum,
      sumPercent: Math.round((bucket.sum / sumTotal) * 100),
    }))
  })

  const dynamic = (current: number, previous: number) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0)
  return names.map((name, index) => ({
    name,
    periods: [
      perPeriod[0][index],
      { ...perPeriod[1][index], dynamic: dynamic(perPeriod[1][index].stores, perPeriod[0][index].stores) },
      { ...perPeriod[2][index], dynamic: dynamic(perPeriod[2][index].stores, perPeriod[1][index].stores) },
    ],
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

async function ensureClassesSchema(db: ReturnType<typeof getDb>) {
  await db.exec("CREATE TABLE IF NOT EXISTS client_classification_classes (id SERIAL PRIMARY KEY, name TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL)")
  const count = (await db.prepare("SELECT COUNT(*) AS n FROM client_classification_classes").get()) as { n: number | string }
  if (Number(count.n) === 0) {
    for (const item of DEFAULT_CLASSES) await db.prepare("INSERT INTO client_classification_classes (name, amount) VALUES (?, ?)").run(item.name, item.amount)
  }
}

export async function getClassificationClasses(): Promise<ClassificationClass[]> {
  const db = getDb()
  await ensureClassesSchema(db)
  const rows = (await db.prepare("SELECT name, amount FROM client_classification_classes ORDER BY amount, id").all()) as { name: string; amount: number }[]
  return rows.map((row) => ({ name: row.name, amount: Number(row.amount) }))
}

/** Replaces the set of classes (the settings dialog saves the whole list). */
export async function saveClassificationClasses(classes: ClassificationClass[]): Promise<ClassificationClass[]> {
  const db = getDb()
  await ensureClassesSchema(db)
  await db.exec("DELETE FROM client_classification_classes")
  for (const item of [...classes].sort((a, b) => a.amount - b.amount)) {
    await db.prepare("INSERT INTO client_classification_classes (name, amount) VALUES (?, ?)").run(item.name, item.amount)
  }
  return getClassificationClasses()
}
