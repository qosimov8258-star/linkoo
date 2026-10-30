import "server-only"

import { clientDays } from "@/lib/agent-visits-repo"
import { loadRateBook } from "@/lib/currency-rates-repo"
import { getDb } from "@/lib/db"
import { listFieldEmployees } from "@/lib/field-activity/employees"
import { normCurrency } from "@/lib/finance/currency"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { orderRealizationTs } from "@/lib/finance/sources"
import { ensureOrdersSchema, parseMoneyText } from "@/lib/orders-repo"
import { selectedBranchName } from "@/lib/selected-branch"
import { costsFromLedger, documentLineUnit, documentLineValues, loadCostLedger } from "@/lib/stock/costs"

// Engine behind the "Отчет по продажам" and "Конструктор" (visits) report builders: the page sends the chosen columns,
// vertical / horizontal groupings and filters; the rows are aggregated here from the real orders / visits instead of
// being faked on the client. Names that have no data source locally are reported back in `unsupported` (their cells
// stay empty) so the page can say so instead of printing made-up numbers. The visits come from the field activity data
// (planned routes + visits of the mobile app), the one source of Активность / Отслеживание.
//
// Sales money is never summed across currencies: every line amount is converted to the base currency (Валюты) with the
// rate its order's currency had when the order was created (lib/currency-rates-repo.ts loadRateBook) before it is
// added; a currency without a rate is left out of the sums and named in `missingRates`. The "…, SUM" columns, profit,
// markup and cost are always in the base currency. The plain "Сумма …" columns are the amount in the document's own
// currency when "Валюта" is one of the groupings (each cell then holds one currency; a total over several currencies
// stays empty instead of mixing them), else the base-currency amount; `documentColumns` names the ones in the
// document's currency, the rest of the money columns are in `currency`. The cost of goods is the one of the stock core
// (lib/stock/costs.ts: the value the cost ledger moved the order's goods at, else the average of the day), in the base
// currency. Days are business days (Asia/Tashkent), as the finance core dates orders.

export type BuilderKind = "sales" | "visits"
export type BuilderInput = {
  kind: BuilderKind
  tab?: string
  from: string
  to: string
  columns: string[]
  vertical: string[]
  horizontal: string[]
  filters?: Record<string, string>
  showTotals?: boolean
  /** Visits only: the employees whose visits the reader may see (their field scope, lib/field-activity/actor.ts);
   * undefined = every employee. */
  employeeIds?: number[]
}
export type BuilderResult = {
  headers: string[]
  /** one entry per header: group columns first, then (horizontal key ×) measure columns */
  rows: (string | number)[][]
  totals: (string | number)[] | null
  unsupported: string[]
  count: number
  /** Base currency code the money columns are in (sales). */
  currency?: string
  /** Currencies of orders that have no rate to the base currency: their amounts are left out (sales). */
  missingRates?: string[]
  /** Money columns whose cells are in the document's own currency (the row's / column's "Валюта" grouping), not in
   * `currency` (sales, only while "Валюта" is a grouping). */
  documentColumns?: string[]
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

const num = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}
const round = (value: number, digits = 3) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
const dmy = (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso)

function isoWeekStart(iso: string) {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date
}
function weekLabel(iso: string) {
  const start = isoWeekStart(iso)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const f = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`
  return `${f(start)} - ${f(end)}`
}
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)} ${iso.slice(0, 4)}`

type Acc = { sums: Map<string, number>; sets: Map<string, Set<string | number>>; min: Map<string, string>; max: Map<string, string> }
const newAcc = (): Acc => ({ sums: new Map(), sets: new Map(), min: new Map(), max: new Map() })
const add = (acc: Acc, key: string, value: number) => acc.sums.set(key, (acc.sums.get(key) ?? 0) + value)
const addSet = (acc: Acc, key: string, value: string | number) => {
  const set = acc.sets.get(key) ?? new Set()
  set.add(value)
  acc.sets.set(key, set)
}
const track = (acc: Acc, key: string, value: string) => {
  if (!value) return
  if (!acc.min.has(key) || value < (acc.min.get(key) as string)) acc.min.set(key, value)
  if (!acc.max.has(key) || value > (acc.max.get(key) as string)) acc.max.set(key, value)
}
const sum = (acc: Acc, key: string) => acc.sums.get(key) ?? 0
const card = (acc: Acc, key: string) => acc.sets.get(key)?.size ?? 0

// ---------------------------------------------------------------- sales

type SalesRec = {
  group: Record<string, string>
  orderId: number
  clientKey: string
  productKey: string
  /** The line has a value (quantity × price > 0 in its own currency): its client counts in АКБ. */
  valued: boolean
  qty: number
  retQty: number
  /** The order's currency (Валюта grouping). */
  currency: string
  /** Money in the base currency (0 when the order's currency has no rate). */
  ordAmount: number
  retAmount: number
  /** The same amounts in the order's own currency. */
  docAmount: number
  docRetAmount: number
  ordCost: number
  retCost: number
  blockQty: number
  bonusQty: number
  bonusRet: number
  weight: number
}

const SALES_COLUMNS = new Set([
  "АКБ заказа", "Вес продуктов заказа", "Вес продуктов возврата", "Вес продуктов факт", "Колв. продуктов заказа", "Колв. продуктов возврата",
  "Колв. продуктов факт", "Колв. блоков заказа", "Колв. блоков возврата", "Колв. блоков факт", "Колв. бонусов заказа", "Колв. бонусов возврата",
  "Колв. бонусов факт", "Колв. оформленных заказов", "Колв. оформленных возвратов", "Прибыль от продаж", "Наценка Заказа (%)", "Сумма заказов",
  "Сумма возвратов", "Сумма факт", "Сумма заказов, SUM", "Сумма возвратов, SUM", "Сумма факт, SUM", "Сумма до переоценки заказов",
  "Сумма до переоценки возвратов", "Сумма до переоценки факт", "Себестоимость заказа", "Себестоимость возврата", "Cебестоимость факт", "Ассортимент",
])
/** Plain amount columns: in the document's own currency while "Валюта" is a grouping, else in the base currency. */
const DOCUMENT_MONEY_COLUMNS = new Set([
  "Сумма заказов", "Сумма возвратов", "Сумма факт", "Сумма до переоценки заказов", "Сумма до переоценки возвратов", "Сумма до переоценки факт",
])
/** Columns that need the cost of goods (the cost ledger is loaded only for them). */
const COST_COLUMNS = new Set(["Себестоимость заказа", "Себестоимость возврата", "Cебестоимость факт", "Прибыль от продаж", "Наценка Заказа (%)"])

/** A sum in the documents' own currency: empty when the cells mix currencies (never added across currencies). */
const documentSum = (acc: Acc, value: number) => (card(acc, "currencies") > 1 ? "" : round(value, 2))

function salesMeasure(acc: Acc, column: string, byDocumentCurrency: boolean): number | string {
  if (byDocumentCurrency && DOCUMENT_MONEY_COLUMNS.has(column)) {
    if (column.endsWith("заказов")) return documentSum(acc, sum(acc, "ad"))
    if (column.endsWith("возвратов")) return documentSum(acc, sum(acc, "ard"))
    return documentSum(acc, sum(acc, "ad") - sum(acc, "ard"))
  }
  switch (column) {
    case "АКБ заказа": return card(acc, "clients")
    case "Вес продуктов заказа": return round(sum(acc, "w"))
    case "Вес продуктов возврата": return round(sum(acc, "wr"))
    case "Вес продуктов факт": return round(sum(acc, "w") - sum(acc, "wr"))
    case "Колв. продуктов заказа": return round(sum(acc, "q"))
    case "Колв. продуктов возврата": return round(sum(acc, "qr"))
    case "Колв. продуктов факт": return round(sum(acc, "q") - sum(acc, "qr"))
    case "Колв. блоков заказа": return round(sum(acc, "b"))
    case "Колв. блоков возврата": return round(sum(acc, "br"))
    case "Колв. блоков факт": return round(sum(acc, "b") - sum(acc, "br"))
    case "Колв. бонусов заказа": return round(sum(acc, "bn"))
    case "Колв. бонусов возврата": return round(sum(acc, "bnr"))
    case "Колв. бонусов факт": return round(sum(acc, "bn") - sum(acc, "bnr"))
    case "Колв. оформленных заказов": return card(acc, "orders")
    case "Колв. оформленных возвратов": return card(acc, "returns")
    // The base currency ("…, SUM" is the reference's name; the plain ones without a "Валюта" grouping).
    case "Сумма заказов": case "Сумма до переоценки заказов": case "Сумма заказов, SUM": return round(sum(acc, "a"), 2)
    case "Сумма возвратов": case "Сумма до переоценки возвратов": case "Сумма возвратов, SUM": return round(sum(acc, "ar"), 2)
    case "Сумма факт": case "Сумма до переоценки факт": case "Сумма факт, SUM": return round(sum(acc, "a") - sum(acc, "ar"), 2)
    case "Себестоимость заказа": return round(sum(acc, "c"), 2)
    case "Себестоимость возврата": return round(sum(acc, "cr"), 2)
    case "Cебестоимость факт": return round(sum(acc, "c") - sum(acc, "cr"), 2)
    case "Прибыль от продаж": return round(sum(acc, "a") - sum(acc, "ar") - (sum(acc, "c") - sum(acc, "cr")), 2)
    case "Наценка Заказа (%)": return sum(acc, "c") > 0 ? round(((sum(acc, "a") - sum(acc, "c")) / sum(acc, "c")) * 100, 2) : 0
    case "Ассортимент": return card(acc, "products")
    default: return 0
  }
}

type SalesOrderRow = Record<string, string | number | null> & { id: number; client_id: number | null; created_at: string; day: string }

async function loadSales(input: BuilderInput, withCost: boolean): Promise<{ records: SalesRec[]; base: string; missingRates: string[] }> {
  await ensureOrdersSchema()
  const db = getDb()
  const s = await ensureFinanceSchema(db)
  const branch = await selectedBranchName()
  const book = await loadRateBook(db)
  // The business day of the order: its creation moment ("… ПО ДАТЕ СОЗДАНИЯ"), else its realization
  // moment as the finance core dates it (shipped_at, a legacy planned delivery day, the creation).
  const byCreation = /СОЗДАН/.test(input.tab ?? "")
  const dayTs = byCreation ? "fin_ts(o.created_at, true)" : orderRealizationTs(s, "o")
  const orders = (await db
    .prepare(
      `SELECT o.id, o.client_id, o.client, o.market_name, o.zone, o.agent, o.delivery_man, o.expeditor, o.organization, o.price_list,
              o.stock_name, o.branch_name, o.pay_type_name, o.deal_type, o.currency, o.amount, o.created_at,
              to_char((${dayTs})::date, 'YYYY-MM-DD') AS day
         FROM orders o
        WHERE o.status <> 'Отменен' AND (@branch::text = '' OR o.branch_name = @branch)
          AND (${dayTs})::date BETWEEN @from::date AND @to::date`,
    )
    .all({ branch, from: input.from, to: input.to })) as SalesOrderRow[]
  if (!orders.length) return { records: [], base: book.base, missingRates: [] }
  // No line of this app is a bonus line (like lib/order-summary-repo.ts). The legacy order_item_bonus table
  // (the reference account's flags, filled only by a removed backfill script) stays in place, unread.
  const items = (await db
    .prepare(
      `SELECT i.id, i.order_id, i.product_id, i.product_name, i.unit, i.quantity, i.unit_price, i.cost_price, i.discount_percent, i.currency,
              COALESCE((to_jsonb(i) ->> 'return_quantity')::float8, 0) AS return_quantity,
              p.brand, p.type AS product_type, p.article, p.integration_code, p.barcode, p.box_amount, p.weight, p.order_number,
              0 AS is_bonus
         FROM order_items i LEFT JOIN products p ON p.id = i.product_id
        WHERE i.order_id = ANY(@ids::int[])
        ORDER BY i.order_id, i.id`,
    )
    .all({ ids: orders.map((order) => Number(order.id)) })) as Record<string, string | number | null>[]
  const clients = (await db.prepare("SELECT id, name, inn, type, code, contact_person, agent, zone FROM clients").all()) as Record<string, string | number>[]
  const clientById = new Map(clients.map((client) => [Number(client.id), client]))
  const clientByName = new Map(clients.map((client) => [String(client.name).trim().toLowerCase(), client]))
  const orderById = new Map(orders.map((order) => [Number(order.id), order]))

  // Cost of goods (base currency): the value the cost ledger moved the order's goods at, else the average of the day.
  const ledger = withCost && items.length ? await loadCostLedger(db) : null
  const moved = ledger ? documentLineValues(ledger) : null
  const costsByDay = new Map<string, Map<string, number>>()
  const costOn = (key: string, day: string) => {
    if (!ledger) return undefined
    let costs = costsByDay.get(day)
    if (!costs) costsByDay.set(day, (costs = costsFromLedger(ledger, day)))
    return costs.get(key)
  }

  const missing = new Set<string>()
  const records: SalesRec[] = []
  for (const item of items) {
    const order = orderById.get(Number(item.order_id))
    if (!order) continue
    const client = (order.client_id !== null ? clientById.get(Number(order.client_id)) : undefined) ?? clientByName.get(String(order.market_name || order.client).trim().toLowerCase())
    const qty = num(item.quantity)
    const retQty = Math.min(qty, num(item.return_quantity))
    const price = num(item.unit_price) * (1 - num(item.discount_percent) / 100)
    // The order's currency (every line is in it); legacy lines: the line's, else the amount text's, else the base.
    const currency = normCurrency(
      String(order.currency || item.currency || parseMoneyText(String(order.amount ?? ""))?.currency || ""),
      book.base,
    )
    const rate = book.rateAt(currency, order.created_at)
    if (rate === null && price !== 0) missing.add(currency)
    const toBase = rate ?? 0
    const day = order.day
    const [first = "", ...rest] = String(order.agent ?? "").split(" ")
    const box = num(item.box_amount)
    const weight = num(item.weight)
    const bonus = Number(item.is_bonus) === 1
    const productKey = item.product_id !== null && item.product_id !== undefined ? `product:${Number(item.product_id)}` : ""
    const ledgerUnit = productKey && moved ? (documentLineUnit(moved, "orders", Number(order.id), productKey) ?? costOn(productKey, day)) : undefined
    // Lines the ledger does not know (no product link): their own cost price, in the order's currency.
    const unitCost = ledgerUnit ?? num(item.cost_price) * toBase
    records.push({
      group: {
        "~Дата по дням": day,
        "~Дата по неделям": isoWeekStart(day).toISOString().slice(0, 10),
        "~Дата по месяцам": day.slice(0, 7),
        "Дата по дням": dmy(day),
        "Дата по неделям": weekLabel(day),
        "Дата по месяцам": monthLabel(day),
        "Валюта": currency,
        "Документ №": String(order.id),
        "Документ Тип": "Заказ",
        "Документ Отв.агент": String(order.agent ?? ""),
        "Документ Отв.агент (Имя)": first,
        "Документ Отв.агент (Фамилия)": rest.join(" "),
        "Доставщик": String(order.delivery_man ?? ""),
        "Сборщик": String(order.expeditor ?? ""),
        "Организация": String(order.organization ?? ""),
        "Прайс-лист": String(order.price_list ?? ""),
        "Продукт ИД": String(item.product_id ?? ""),
        "Продукт Название": String(item.product_name ?? ""),
        "Продукт Ед. изм": String(item.unit ?? ""),
        "Продукт Бренд": String(item.brand ?? ""),
        "Тип продукта": String(item.product_type ?? ""),
        "Продукт Порядковый номер": String(item.order_number ?? ""),
        "Продукт Артикул": String(item.article ?? ""),
        "Продукт Код": String(item.integration_code ?? ""),
        "Продукт Штрих-код": String(item.barcode ?? ""),
        "Магазин №": client ? String(client.id) : "",
        "Магазин Название": String(order.market_name || order.client || ""),
        "Магазин Контактное лицо": client ? String(client.contact_person ?? "") : "",
        "Магазин ИНН": client ? String(client.inn ?? "") : "",
        "Магазин Тип магазина": client ? String(client.type ?? "") : "",
        "Магазин Код": client ? String(client.code ?? "") : "",
        "Магазин Ответственный агент": client ? String(client.agent ?? "") : "",
        "Склад": String(order.stock_name ?? ""),
        "Территория": String(order.zone ?? ""),
        "Тип оплаты": String(order.pay_type_name ?? ""),
        "Тип сделки": String(order.deal_type ?? ""),
        "Филиал": String(order.branch_name ?? ""),
        "Цена": String(round(num(item.unit_price), 2)),
        "Себестоимость": String(round(unitCost, 2)),
      },
      orderId: Number(order.id),
      clientKey: client ? `id:${client.id}` : `name:${String(order.market_name || order.client).trim().toLowerCase()}`,
      productKey: productKey || `name:${String(item.product_name ?? "").trim().toLowerCase()}`,
      valued: qty * price > 0,
      qty,
      retQty,
      currency,
      ordAmount: qty * price * toBase,
      retAmount: retQty * price * toBase,
      docAmount: qty * price,
      docRetAmount: retQty * price,
      ordCost: qty * unitCost,
      retCost: retQty * unitCost,
      blockQty: box > 0 ? qty / box : 0,
      bonusQty: bonus ? qty : 0,
      bonusRet: bonus ? retQty : 0,
      weight: qty * weight,
    })
  }
  return { records, base: book.base, missingRates: [...missing].sort() }
}

const SALES_FILTER_FIELD: Record<string, string> = {
  "Бренд": "Продукт Бренд", "Доставщик": "Доставщик", "Организация": "Организация", "Прайс-лист": "Прайс-лист", "Продукт": "Продукт Название",
  "Склад": "Склад", "Склад заказа": "Склад", "Территория": "Территория", "Тип продукта": "Тип продукта", "Тип оплаты": "Тип оплаты",
  "Филиал": "Филиал", "Магазин": "Магазин Название", "Ответственный агент магазина": "Магазин Ответственный агент", "Документ Отв. агент": "Документ Отв.агент",
  "Магазин ИНН": "Магазин ИНН", "Тип магазина": "Магазин Тип магазина",
}

function accumulateSales(acc: Acc, rec: SalesRec) {
  add(acc, "q", rec.qty); add(acc, "qr", rec.retQty)
  add(acc, "a", rec.ordAmount); add(acc, "ar", rec.retAmount)
  add(acc, "ad", rec.docAmount); add(acc, "ard", rec.docRetAmount)
  addSet(acc, "currencies", rec.currency)
  add(acc, "c", rec.ordCost); add(acc, "cr", rec.retCost)
  add(acc, "b", rec.blockQty); add(acc, "br", rec.qty > 0 ? rec.blockQty * (rec.retQty / rec.qty) : 0)
  add(acc, "bn", rec.bonusQty); add(acc, "bnr", rec.bonusRet)
  add(acc, "w", rec.weight); add(acc, "wr", rec.qty > 0 ? rec.weight * (rec.retQty / rec.qty) : 0)
  addSet(acc, "orders", rec.orderId)
  if (rec.retQty > 0) addSet(acc, "returns", rec.orderId)
  if (rec.valued) addSet(acc, "clients", rec.clientKey)
  addSet(acc, "products", rec.productKey)
}

// ---------------------------------------------------------------- visits

type VisitRec = { group: Record<string, string>; planned: boolean; visited: boolean; effective: boolean; refused: boolean; started: string }
const VISIT_COLUMNS = new Set(["План визитов", "Посещено", "Посещено по плану", "Выполнение плана, %", "Посещено вне плана", "Не посещено", "Результативный визит", "Strike Rate, %", "Отказано", "Первая активность", "Последная активность"])

function visitMeasure(acc: Acc, column: string): number | string {
  const planned = sum(acc, "plan")
  switch (column) {
    case "План визитов": return planned
    case "Посещено": return sum(acc, "visited")
    case "Посещено по плану": return sum(acc, "visitedPlan")
    case "Выполнение плана, %": return planned > 0 ? round((sum(acc, "visitedPlan") / planned) * 100, 2) : 0
    case "Посещено вне плана": return sum(acc, "visitedOff")
    case "Не посещено": return sum(acc, "missed")
    case "Результативный визит": return sum(acc, "effective")
    case "Strike Rate, %": return sum(acc, "visited") > 0 ? round((sum(acc, "effective") / sum(acc, "visited")) * 100, 2) : 0
    case "Отказано": return sum(acc, "refused")
    case "Первая активность": return acc.min.get("started")?.slice(11, 19) ?? ""
    case "Последная активность": return acc.max.get("started")?.slice(11, 19) ?? ""
    default: return 0
  }
}

/** Visit records from the field activity data (one per employee, day and planned or visited client), the same
 * source as Активность / Отслеживание: lib/agent-visits-repo.ts clientDays, limited to the reader's field scope
 * (`input.employeeIds`; an empty list yields no records). */
async function loadVisits(input: BuilderInput) {
  const days = await clientDays(input.from, input.to, input.employeeIds)
  const db = getDb()
  const employeeIds = [...new Set(days.map((day) => day.employeeId))]
  const clientIds = [...new Set(days.map((day) => day.clientId))]
  const employees = employeeIds.length
    ? ((await db.prepare("SELECT id, first_name, last_name FROM employees WHERE id = ANY(@ids::int[])").all({ ids: employeeIds })) as {
        id: number
        first_name: string | null
        last_name: string | null
      }[])
    : []
  const clients = clientIds.length
    ? ((await db.prepare("SELECT id, name, zone, code FROM clients WHERE id = ANY(@ids::int[])").all({ ids: clientIds })) as {
        id: number
        name: string | null
        zone: string | null
        code: string | null
      }[])
    : []
  const employeeName = new Map(employees.map((row) => [Number(row.id), `${String(row.first_name ?? "").trim()} ${String(row.last_name ?? "").trim()}`.trim()]))
  const clientOf = new Map(clients.map((row) => [Number(row.id), row]))
  const refusalsOnly = input.tab === "ОТКАЗЫ"
  const spaced = (stamp: string | null) => (stamp ? stamp.replace("T", " ") : "")
  const records: VisitRec[] = []
  for (const day of days) {
    if (refusalsOnly && !day.refused) continue
    const client = clientOf.get(day.clientId)
    const visited = day.visits > 0
    const done = visited ? day.day : ""
    records.push({
      group: {
        "~Дата плана": day.day,
        "~Дата выполнения": done,
        "~По дням": day.day,
        "Пользователь": employeeName.get(day.employeeId) || `#${day.employeeId}`,
        "Зона": String(client?.zone ?? ""),
        "Код магазина": String(client?.code ?? ""),
        "Дата плана": day.planned ? dmy(day.day) : "",
        "Время выполнения": day.firstStart ? day.firstStart.slice(11, 19) : "",
        "Дата выполнения": done ? dmy(done) : "",
        "По дням": dmy(day.day),
        "Магазин": String(client?.name ?? `#${day.clientId}`),
        "ИД плана": day.planId === null ? "" : String(day.planId),
        "Время обслуживания (мин)": visited ? String(round(day.storeSec / 60, 2)) : "",
        "Начало обслуживания": spaced(day.firstStart),
        "Конец обслуживания": spaced(day.lastEnd),
        "Статус": day.open ? "В процессе" : visited ? "Выполнено" : "Невыполнено",
      },
      planned: day.planned,
      visited,
      effective: day.effective,
      refused: day.refused,
      started: spaced(day.firstStart),
    })
  }
  return records
}

function accumulateVisit(acc: Acc, rec: VisitRec) {
  add(acc, "plan", rec.planned ? 1 : 0)
  add(acc, "visited", rec.visited ? 1 : 0)
  add(acc, "visitedPlan", rec.planned && rec.visited ? 1 : 0)
  add(acc, "visitedOff", !rec.planned && rec.visited ? 1 : 0)
  add(acc, "missed", rec.planned && !rec.visited ? 1 : 0)
  add(acc, "effective", rec.effective ? 1 : 0)
  add(acc, "refused", rec.refused ? 1 : 0)
  track(acc, "started", rec.started)
}

// ---------------------------------------------------------------- shared

export async function runBuilderReport(input: BuilderInput): Promise<BuilderResult> {
  const sales = input.kind === "sales"
  const supportedColumns = sales ? SALES_COLUMNS : VISIT_COLUMNS
  const columns = input.columns.filter((column) => supportedColumns.has(column))
  // The cost ledger only when a cost column or the "Себестоимость" grouping is asked for.
  const withCost = columns.some((column) => COST_COLUMNS.has(column)) || [...input.vertical, ...input.horizontal].includes("Себестоимость")
  const salesData = sales ? await loadSales(input, withCost) : null
  const records = (salesData ? salesData.records : await loadVisits(input)) as (SalesRec | VisitRec)[]

  const filters = Object.entries(input.filters ?? {}).filter(([, value]) => value)
  const visitFilterField: Record<string, string> = { "Пользователь": "Пользователь", "Зона": "Зона", "Статус": "Статус" }
  const filtered = records.filter((rec) =>
    filters.every(([label, value]) => {
      const field = sales ? SALES_FILTER_FIELD[label] : visitFilterField[label]
      return field ? (rec.group[field] ?? "") === value : true
    }),
  )

  const unsupported = new Set<string>()
  for (const name of input.columns) if (!supportedColumns.has(name)) unsupported.add(name)
  const known = new Set(Object.keys(records[0]?.group ?? {}))
  const groupSupported = (name: string) => (records.length ? known.has(name) : true)
  for (const name of [...input.vertical, ...input.horizontal]) if (!groupSupported(name)) unsupported.add(name)
  const vertical = input.vertical.filter(groupSupported)
  const horizontal = input.horizontal.filter(groupSupported)
  // The plain "Сумма …" columns are in each document's own currency only while "Валюта" splits the cells by currency.
  const byDocumentCurrency = sales && [...vertical, ...horizontal].includes("Валюта")

  const rowsMap = new Map<string, { labels: string[]; sort: string; cells: Map<string, Acc> }>()
  const horizontalKeys = new Set<string>()
  const totalAcc = new Map<string, Acc>()
  const accumulate = (acc: Acc, rec: SalesRec | VisitRec) => (sales ? accumulateSales(acc, rec as SalesRec) : accumulateVisit(acc, rec as VisitRec))
  for (const rec of filtered) {
    const rowLabels = vertical.map((name) => rec.group[name] ?? "")
    const rowKey = rowLabels.join("\u0001")
    const colKey = horizontal.map((name) => rec.group[name] ?? "").join(" / ")
    horizontalKeys.add(colKey)
    const row = rowsMap.get(rowKey) ?? { labels: rowLabels, sort: vertical.map((name) => rec.group["~" + name] ?? rec.group[name] ?? "").join("\u0001"), cells: new Map<string, Acc>() }
    rowsMap.set(rowKey, row)
    const cell = row.cells.get(colKey) ?? newAcc()
    row.cells.set(colKey, cell)
    accumulate(cell, rec)
    const total = totalAcc.get(colKey) ?? newAcc()
    totalAcc.set(colKey, total)
    accumulate(total, rec)
  }

  const colKeys = [...horizontalKeys].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
  const measure = (acc: Acc | undefined, column: string) =>
    acc ? (sales ? salesMeasure(acc, column, byDocumentCurrency) : visitMeasure(acc, column)) : sales ? 0 : column.includes("активность") ? "" : 0
  const headers = [...vertical, ...colKeys.flatMap((key) => columns.map((column) => (horizontal.length && key ? `${key} · ${column}` : column)))]
  const rows = [...rowsMap.values()]
    .sort((a, b) => a.sort.localeCompare(b.sort, "ru", { numeric: true }))
    .map((row) => [...row.labels, ...colKeys.flatMap((key) => columns.map((column) => measure(row.cells.get(key), column)))])
  const totals = input.showTotals === false ? null : [...vertical.map((_, index) => (index === 0 ? "Итого" : "")), ...colKeys.flatMap((key) => columns.map((column) => measure(totalAcc.get(key), column)))]
  const result: BuilderResult = { headers, rows, totals, unsupported: [...unsupported], count: filtered.length }
  if (!salesData) return result
  const documentColumns = byDocumentCurrency ? columns.filter((column) => DOCUMENT_MONEY_COLUMNS.has(column)) : []
  return { ...result, currency: salesData.base, missingRates: salesData.missingRates, documentColumns }
}

/** Distinct values per filter label for the filter selects of the page. For visits, `employeeIds` is the reader's
 * field scope (undefined = every employee): an agent's "Пользователь" list names only the employees they may see. */
export async function builderFilterOptions(kind: BuilderKind, employeeIds?: number[]): Promise<Record<string, string[]>> {
  const db = getDb()
  const distinct = async (sql: string) => ((await db.prepare(sql).all()) as { v: string }[]).map((row) => row.v).filter(Boolean)
  if (kind === "visits") {
    // The employees and the zones of the directory (Клиенты → зоны), like the field pages.
    return {
      "Пользователь": [...new Set((await listFieldEmployees({ activeOnly: true, employeeIds })).map((employee) => employee.name).filter(Boolean))],
      "Статус": ["В процессе", "Выполнено", "Невыполнено"],
      "Зона": await distinct("SELECT name AS v FROM client_zones ORDER BY lower(name), id"),
    }
  }
  return {
    "Бренд": await distinct("SELECT DISTINCT brand AS v FROM products WHERE brand <> '' ORDER BY 1"),
    "Доставщик": await distinct("SELECT DISTINCT delivery_man AS v FROM orders WHERE delivery_man <> '' ORDER BY 1"),
    "Организация": await distinct("SELECT DISTINCT organization AS v FROM orders WHERE organization <> '' ORDER BY 1"),
    "Прайс-лист": await distinct("SELECT DISTINCT price_list AS v FROM orders WHERE price_list <> '' ORDER BY 1"),
    "Продукт": await distinct("SELECT DISTINCT product_name AS v FROM order_items ORDER BY 1"),
    "Склад": await distinct("SELECT DISTINCT stock_name AS v FROM orders WHERE stock_name <> '' ORDER BY 1"),
    "Территория": await distinct("SELECT DISTINCT zone AS v FROM orders WHERE zone <> '' ORDER BY 1"),
    "Тип продукта": await distinct("SELECT DISTINCT type AS v FROM products WHERE type <> '' ORDER BY 1"),
    "Тип оплаты": await distinct("SELECT DISTINCT pay_type_name AS v FROM orders WHERE pay_type_name <> '' ORDER BY 1"),
    "Филиал": await distinct("SELECT DISTINCT branch_name AS v FROM orders WHERE branch_name <> '' ORDER BY 1"),
    "Магазин": await distinct("SELECT DISTINCT market_name AS v FROM orders WHERE market_name <> '' ORDER BY 1"),
    "Документ Отв. агент": await distinct("SELECT DISTINCT agent AS v FROM orders WHERE agent <> '' ORDER BY 1"),
    "Ответственный агент магазина": await distinct("SELECT DISTINCT agent AS v FROM clients WHERE agent <> '' ORDER BY 1"),
    "Тип магазина": await distinct("SELECT DISTINCT type AS v FROM clients WHERE type <> '' ORDER BY 1"),
  }
}
