import "server-only"

import { countRefusalsByDay } from "@/lib/agent-visits-repo"
import { loadRateBook } from "@/lib/currency-rates-repo"
import { getDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { ensureOrdersSchema, parseMoneyText } from "@/lib/orders-repo"
import { keySql, nameKey } from "@/lib/platform-refs"
import { selectedBranchName } from "@/lib/selected-branch"

// Data behind the dashboard "ПРОДАЖА" tab (demo #/ ?toggleTab=sales). The numbers follow the demo's
// stats/widget endpoints: cancelled orders are left out, an order counts by its creation day (the
// business day, Asia/Tashkent), its fact price is converted to the base currency (Валюты) with the
// rate its currency had when the order was created (lib/currency-rates-repo.ts loadRateBook) before
// anything is summed — a currency without a rate is left out and named in `missingRates` — and the
// "ОКБ" of a row is the number of clients (not in the "closing" tab) that belong to it.

export type SalesFilters = {
  zones?: string[]
  marketTypes?: string[]
  productTypes?: string[]
  agents?: string[]
  brands?: string[]
  /** The employees whose field refusals the reader may count (their field scope, lib/field-activity/actor.ts):
   * undefined = every employee, [] = none. Set by the route, never by a query parameter. */
  fieldEmployeeIds?: number[]
}

export type SalesRow = { id: number; name: string; amount: number; okb: number; akb: number; akbIndex: number; percent: number }
export type SalesGroup = { data: SalesRow[]; total: { amount: number; okb: number; akb: number; akbIndex: number } }
export type SalesDay = { date: string; akb: number; reject: number; sales: number }
export type SalesStats = {
  border: SalesGroup
  user: SalesGroup
  productType: SalesGroup
  marketType: SalesGroup
  dynamic: SalesDay[]
  /** fact price sums (base currency) for the "Продажа" bar chart, keyed by the demo's labels */
  day: { label: string; total: number }[]
  week: { label: string; total: number }[]
  month: { label: string; total: number }[]
  /** Base currency code every amount is in. */
  currency: string
  /** Currencies of orders that have no rate to the base currency: their amounts are left out. */
  missingRates: string[]
}
export type SalesOptions = { zones: string[]; marketTypes: string[]; productTypes: string[]; agents: string[]; brands: string[] }

type OrderRow = {
  id: number
  client: string
  market_name: string
  zone: string
  agent: string
  type: string
  amount: string
  currency: string | null
  fact_price: number | null
  return_price: number | null
  created_at: string
  /** Business day (Asia/Tashkent) of created_at. */
  day: string
}
type ItemRow = { order_id: number; quantity: number; unit_price: number; discount_percent: number | null; product_type: string | null; brand: string | null }

const UNSET = "Не указано"

// the demo counts distinct markets, i.e. the order's market, not the contact name
const clientOf = (order: { client: string; market_name: string }) => order.market_name || order.client

const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function isoWeekStart(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`)
  const shift = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - shift)
  return date
}

const dmy = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}`
const dmyOfIso = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

/** `begin` / `end`: checked business days "YYYY-MM-DD" (app/api/sales-stats/route.ts). */
export async function getSalesStats(begin: string, end: string, filters: SalesFilters = {}): Promise<SalesStats> {
  await ensureOrdersSchema()
  const db = getDb()
  await ensureFinanceSchema(db) // fin_ts
  const branch = await selectedBranchName()
  const book = await loadRateBook(db)

  const orders = (await db
    .prepare(
      `SELECT id, client, market_name, zone, agent, type, amount, currency, fact_price, return_price, created_at,
              to_char(fin_ts(created_at, true)::date, 'YYYY-MM-DD') AS day
         FROM orders
        WHERE fin_ts(created_at, true)::date BETWEEN @begin::date AND @end::date AND status <> 'Отменен'
          AND (@branch::text = '' OR branch_name = @branch)
        ORDER BY id`,
    )
    .all({ begin, end, branch })) as OrderRow[]

  const ids = orders.map((order) => Number(order.id))
  const items = ids.length
    ? ((await db
        .prepare(
          `SELECT i.order_id, i.quantity, i.unit_price, i.discount_percent, p.type AS product_type, p.brand AS brand
           FROM order_items i LEFT JOIN products p ON p.id = i.product_id
           WHERE i.order_id = ANY(@ids::int[])`,
        )
        .all({ ids })) as ItemRow[])
    : []
  const itemsByOrder = new Map<number, ItemRow[]>()
  for (const item of items) itemsByOrder.set(Number(item.order_id), [...(itemsByOrder.get(Number(item.order_id)) ?? []), item])

  // The order's fact price (ordered − returned) in the base currency, with its currency's rate at its creation.
  // Orders written before fact_price existed: the amount text − the returned value.
  const missing = new Set<string>()
  const factInBase = (order: OrderRow): number => {
    const text = parseMoneyText(String(order.amount ?? ""))
    const fact = order.fact_price ?? (text?.value ?? 0) - Number(order.return_price ?? 0)
    const currency = normCurrency(order.currency || text?.currency || "", book.base)
    const rate = book.rateAt(currency, order.created_at)
    if (rate === null) {
      if (fact) missing.add(currency)
      return 0
    }
    return fact * rate
  }
  const clientRows = (await db.prepare("SELECT zone, agent, type FROM clients WHERE tab <> 'closing'").all()) as {
    zone: string
    agent: string
    type: string
  }[]
  const countBy = (pick: (row: { zone: string; agent: string; type: string }) => string) => {
    const map = new Map<string, number>()
    for (const row of clientRows) {
      const key = pick(row)
      if (key) map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }
  const okbZone = countBy((row) => row.zone)
  const okbAgent = countBy((row) => row.agent)
  const okbType = countBy((row) => row.type)

  const has = (list: string[] | undefined) => !!list && list.length > 0
  const zoneName = (order: OrderRow) => order.zone || UNSET

  type Line = { order: OrderRow; amount: number; productType: string }
  const lines: Line[] = []
  const baseByOrder = new Map<number, number>()
  for (const order of orders) {
    if (has(filters.zones) && !filters.zones!.includes(zoneName(order))) continue
    if (has(filters.marketTypes) && !filters.marketTypes!.includes(order.type)) continue
    if (has(filters.agents) && !filters.agents!.includes(order.agent)) continue
    const total = factInBase(order)
    const orderItems = itemsByOrder.get(order.id) ?? []
    const gross = orderItems.reduce((sum, item) => sum + item.quantity * item.unit_price * (1 - (item.discount_percent ?? 0) / 100), 0)
    const kept = orderItems.filter(
      (item) =>
        (!has(filters.productTypes) || filters.productTypes!.includes(item.product_type ?? UNSET)) &&
        (!has(filters.brands) || filters.brands!.includes(item.brand ?? UNSET)),
    )
    if ((has(filters.productTypes) || has(filters.brands)) && kept.length === 0) continue
    if (orderItems.length === 0) {
      lines.push({ order, amount: total, productType: UNSET })
    } else {
      for (const item of kept) {
        const share = gross > 0 ? (item.quantity * item.unit_price * (1 - (item.discount_percent ?? 0) / 100)) / gross : 1 / orderItems.length
        lines.push({ order, amount: total * share, productType: item.product_type || UNSET })
      }
    }
    baseByOrder.set(order.id, total)
  }

  const group = (keyOf: (line: Line) => string, okbOf: (name: string) => number, totalOkb?: number): SalesGroup => {
    const map = new Map<string, { amount: number; clients: Set<string> }>()
    for (const line of lines) {
      const key = keyOf(line)
      const entry = map.get(key) ?? { amount: 0, clients: new Set<string>() }
      entry.amount += line.amount
      entry.clients.add(clientOf(line.order))
      map.set(key, entry)
    }
    const total = [...map.values()].reduce((sum, entry) => sum + entry.amount, 0)
    const data = [...map.entries()]
      .map(([name, entry], index) => {
        const okb = okbOf(name)
        const akb = entry.clients.size
        return {
          id: index + 1,
          name,
          amount: round(entry.amount, 2),
          okb,
          akb,
          akbIndex: round(okb > 0 ? (akb / okb) * 100 : akb * 100, 1),
          percent: total > 0 ? round((entry.amount / total) * 100, 1) : 0,
        }
      })
      .sort((a, b) => b.amount - a.amount)
    const okb = totalOkb ?? data.reduce((sum, row) => sum + row.okb, 0)
    const akb = data.reduce((sum, row) => sum + row.akb, 0)
    return { data, total: { amount: round(total, 2), okb, akb, akbIndex: okb > 0 ? (akb / okb) * 100 : akb * 100 } }
  }

  // sales_dynamic: converted sums and distinct clients per creation day
  const perDay = new Map<string, { sales: number; clients: Set<string> }>()
  for (const line of lines) {
    const day = line.order.day
    const entry = perDay.get(day) ?? { sales: 0, clients: new Set<string>() }
    entry.sales += line.amount
    entry.clients.add(clientOf(line.order))
    perDay.set(day, entry)
  }
  // Refusals of the field visits (field_refusals, the data of Активность), narrowed by the same agent / zone /
  // market-type filters: the agents (employee names) and the clients are resolved to their ids.
  let refusalEmployeeIds: number[] | undefined
  if (has(filters.agents)) {
    const rows = (await db
      .prepare(`SELECT id FROM employees WHERE ${keySql("first_name || ' ' || last_name")} = ANY(@keys::text[])`)
      .all({ keys: filters.agents!.map(nameKey) })) as { id: number }[]
    refusalEmployeeIds = rows.map((row) => Number(row.id))
  }
  // An agent counts only the refusals of their own field scope (themselves and their supervised agents).
  if (filters.fieldEmployeeIds) {
    const scope = new Set(filters.fieldEmployeeIds)
    refusalEmployeeIds = refusalEmployeeIds ? refusalEmployeeIds.filter((id) => scope.has(id)) : [...scope]
  }
  let refusalClientIds: number[] | undefined
  if (has(filters.zones) || has(filters.marketTypes)) {
    const clauses: string[] = []
    const params: string[] = []
    if (has(filters.zones)) {
      clauses.push(`zone IN (${filters.zones!.map(() => "?").join(",")})`)
      params.push(...filters.zones!)
    }
    if (has(filters.marketTypes)) {
      clauses.push(`type IN (${filters.marketTypes!.map(() => "?").join(",")})`)
      params.push(...filters.marketTypes!)
    }
    refusalClientIds = ((await db.prepare(`SELECT id FROM clients WHERE ${clauses.join(" AND ")}`).all(...params)) as { id: number }[]).map((row) => row.id)
  }
  const refusals = await countRefusalsByDay(begin, end, { employeeIds: refusalEmployeeIds, clientIds: refusalClientIds })
  for (const day of refusals.keys()) if (!perDay.has(day)) perDay.set(day, { sales: 0, clients: new Set<string>() })
  const dynamic = [...perDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => ({ date, akb: entry.clients.size, reject: refusals.get(date) ?? 0, sales: round(entry.sales, 2) }))

  // report_many: sums (base currency) per day / week / month
  const rawDay = new Map<string, number>()
  const rawWeek = new Map<string, number>()
  const rawMonth = new Map<string, number>()
  const seenOrders = new Set<number>()
  for (const line of lines) {
    if (seenOrders.has(line.order.id)) continue
    seenOrders.add(line.order.id)
    const iso = line.order.day
    const raw = baseByOrder.get(line.order.id) ?? 0
    rawDay.set(iso, (rawDay.get(iso) ?? 0) + raw)
    const start = isoWeekStart(iso)
    const stop = new Date(start)
    stop.setUTCDate(stop.getUTCDate() + 6)
    const weekLabel = `${dmy(start)} - ${dmy(stop)}`
    rawWeek.set(weekLabel, (rawWeek.get(weekLabel) ?? 0) + raw)
    const monthLabel = `01.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
    rawMonth.set(monthLabel, (rawMonth.get(monthLabel) ?? 0) + raw)
  }
  const series = (map: Map<string, number>, label: (key: string) => string) =>
    [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, total]) => ({ label: label(key), total: round(total, 2) }))
  const labelKey = (label: string) => label.slice(6, 10) + label.slice(3, 5) + label.slice(0, 2)
  const sortedWeeks = [...rawWeek.entries()].sort(([a], [b]) => labelKey(a).localeCompare(labelKey(b)))

  const allClientsCount = clientRows.length
  return {
    border: group(zoneNameOf, (name) => (name === UNSET ? 0 : okbZone.get(name) ?? 0)),
    user: group((line) => line.order.agent, (name) => okbAgent.get(name) ?? 0),
    productType: group((line) => line.productType, () => allClientsCount, allClientsCount),
    marketType: group((line) => line.order.type, (name) => okbType.get(name) ?? 0),
    dynamic,
    day: series(rawDay, dmyOfIso),
    week: sortedWeeks.map(([label, total]) => ({ label, total: round(total, 2) })),
    month: series(rawMonth, (key) => key),
    currency: book.base,
    missingRates: [...missing].sort(),
  }

  function zoneNameOf(line: Line) {
    return zoneName(line.order)
  }
}

export async function getSalesOptions(): Promise<SalesOptions> {
  const db = getDb()
  const names = async (sql: string) => ((await db.prepare(sql).all()) as { name: string }[]).map((row) => row.name).filter(Boolean)
  return {
    zones: await names("SELECT DISTINCT zone AS name FROM clients WHERE zone <> '' ORDER BY zone"),
    marketTypes: await names("SELECT DISTINCT type AS name FROM clients WHERE type <> '' ORDER BY type"),
    productTypes: await names("SELECT name FROM product_types ORDER BY name"),
    agents: await names("SELECT TRIM(first_name || ' ' || last_name) AS name FROM employees WHERE active = 1 ORDER BY 1"),
    brands: await names("SELECT name FROM brands ORDER BY name"),
  }
}
