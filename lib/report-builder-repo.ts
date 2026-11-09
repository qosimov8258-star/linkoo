import "server-only"

import { clientDays } from "@/lib/agent-visits-repo"
import { loadRateBook } from "@/lib/currency-rates-repo"
import { getDb } from "@/lib/db"
import { listFieldEmployees } from "@/lib/field-activity/employees"
import { baseReportCurrency, loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { orderRealizationTs, orderReleasedSql } from "@/lib/finance/sources"
import { ensureOrdersSchema, parseMoneyText } from "@/lib/orders-repo"
import { selectedBranchName } from "@/lib/selected-branch"
import { costsFromLedger, documentLineUnit, documentLineValues, loadCostLedger } from "@/lib/stock/costs"

// Engine behind the "Отчет по продажам" and "Конструктор" (visits) report builders: the page sends the chosen columns,
// vertical / horizontal groupings and filters; the rows are aggregated here from the real orders / visits instead of
// being faked on the client. Names that have no data source locally are reported back in `unsupported` (their cells
// stay empty) so the page can say so instead of printing made-up numbers. The visits come from the field activity data
// (planned routes + visits of the mobile app), the one source of Активность / Отслеживание.
//
// Sales money: the "…, SUM" columns, profit, markup and cost convert every line amount to the base currency (Валюты)
// with the rate its order's currency had when the order was created (lib/currency-rates-repo.ts loadRateBook); a
// currency without a rate is left out of those sums and named in `missingRates`. The plain "Сумма …" columns are the
// documents' own amounts as the reference adds them up (its report_html sums the order totals without converting
// them): `documentColumns` names them, the rest of the money columns are in `currency`. The cost of goods is the one
// of the stock core (lib/stock/costs.ts: the value the cost ledger moved the order's goods at, else the average of the
// day), in the base currency. Days are business days (Asia/Tashkent).
//
// The tabs are the reference's models: "… ПО ДАТЕ СОЗДАНИЯ" dates every order that is not cancelled by its creation;
// "… ПО ДАТЕ РЕАЛИЗАЦИИ" (order_and_return_delivery) takes the realized orders only (В пути / Доставлено) on the day
// they were accepted (orders.accepted_date, the reference's accepted_time; an order of this app without one: the
// moment it was shipped, as the finance core dates a realization). Rows and columns come in the reference's order:
// texts by their characters (Latin before Cyrillic), numbers by value, dates by date; an empty name is "Не указано".

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
  /** Money columns whose cells are the documents' own amounts added up as they are (sales: the plain "Сумма …"
   * ones), not amounts in `currency`. */
  documentColumns?: string[]
  /** The groupings the rows are split by (the supported ones of the request, in its order). */
  vertical?: string[]
  /** The horizontal grouping values (" / "-joined), in column order; [""] without a horizontal grouping. */
  keys?: string[]
  /** The measure columns of each key (the supported ones of the request, in its order). */
  columns?: string[]
  /** With a horizontal grouping: each row's measures over all of its columns (the "Итоги справа" column), in `columns` order. */
  rowTotals?: (string | number)[][]
  /** With a horizontal grouping: the measures over every row and column (the corner of the two totals). */
  grandTotals?: (string | number)[]
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
/** Plain amount columns: the documents' own amounts added up as they are (the reference's "Сумма заказов"). */
const DOCUMENT_MONEY_COLUMNS = new Set([
  "Сумма заказов", "Сумма возвратов", "Сумма факт", "Сумма до переоценки заказов", "Сумма до переоценки возвратов", "Сумма до переоценки факт",
])
/** Columns that need the cost of goods (the cost ledger is loaded only for them). */
const COST_COLUMNS = new Set(["Себестоимость заказа", "Себестоимость возврата", "Cебестоимость факт", "Прибыль от продаж", "Наценка Заказа (%)"])

function salesMeasure(acc: Acc, column: string): number | string {
  if (DOCUMENT_MONEY_COLUMNS.has(column)) {
    if (column.endsWith("заказов")) return round(sum(acc, "ad"), 2)
    if (column.endsWith("возвратов")) return round(sum(acc, "ard"), 2)
    return round(sum(acc, "ad") - sum(acc, "ard"), 2)
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
    // The base currency ("…, SUM" is the reference's name of it).
    case "Сумма заказов, SUM": return round(sum(acc, "a"), 2)
    case "Сумма возвратов, SUM": return round(sum(acc, "ar"), 2)
    case "Сумма факт, SUM": return round(sum(acc, "a") - sum(acc, "ar"), 2)
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
  // With an app currency (Настройки → Валюта приложения) every amount is shown in it: base amounts × factor,
  // and the documents' own amounts too (the "Валюта" grouping then has the app currency only).
  const cc = await loadCurrencyContext(db)
  const shown = baseReportCurrency(cc)
  const appCurrency = cc.work
  // The business day of the order: its creation moment ("… ПО ДАТЕ СОЗДАНИЯ", every order that is not cancelled),
  // else the day a realized order was accepted (the reference's accepted_time; this app's orders: the moment they
  // were shipped, then the finance core's fallbacks).
  const byCreation = /СОЗДАН/.test(input.tab ?? "")
  const accepted = s.col("orders", "accepted_date") ? `fin_ts(NULLIF(o.accepted_date, ''))` : "NULL::timestamp"
  const dayTs = byCreation ? "fin_ts(o.created_at, true)" : `COALESCE(${accepted}, ${orderRealizationTs(s, "o")})`
  const scope = byCreation ? "o.status <> 'Отменен'" : orderReleasedSql("o")
  const orders = (await db
    .prepare(
      `SELECT o.id, o.client_id, o.client, o.market_name, o.zone, o.agent, o.delivery_man, o.expeditor, o.organization, o.price_list,
              o.stock_name, o.branch_name, o.pay_type_name, o.deal_type, o.currency, o.amount, o.created_at,
              to_char((${dayTs})::date, 'YYYY-MM-DD') AS day
         FROM orders o
        WHERE ${scope} AND (@branch::text = '' OR o.branch_name = @branch)
          AND (${dayTs})::date BETWEEN @from::date AND @to::date`,
    )
    .all({ branch, from: input.from, to: input.to })) as SalesOrderRow[]
  if (!orders.length) return { records: [], base: shown.code, missingRates: [] }
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
    const toBase = (rate ?? 0) * shown.factor
    // The document's own amounts: in the app currency when one is chosen.
    const toDoc = appCurrency ? toBase : 1
    const day = order.day
    const [first = "", ...rest] = String(order.agent ?? "").split(" ")
    const box = num(item.box_amount)
    const weight = num(item.weight)
    const bonus = Number(item.is_bonus) === 1
    const productKey = item.product_id !== null && item.product_id !== undefined ? `product:${Number(item.product_id)}` : ""
    const ledgerUnit = productKey && moved ? (documentLineUnit(moved, "orders", Number(order.id), productKey) ?? costOn(productKey, day)) : undefined
    // Lines the ledger does not know (no product link): their own cost price, in the order's currency.
    const unitCost = ledgerUnit !== undefined ? ledgerUnit * shown.factor : num(item.cost_price) * toBase
    records.push({
      group: {
        "~Дата по дням": day,
        "~Дата по неделям": isoWeekStart(day).toISOString().slice(0, 10),
        "~Дата по месяцам": day.slice(0, 7),
        "Дата по дням": dmy(day),
        "Дата по неделям": weekLabel(day),
        "Дата по месяцам": monthLabel(day),
        "Валюта": appCurrency || currency,
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
        "Цена": String(round(num(item.unit_price) * toDoc, 2)),
        "Себестоимость": String(round(unitCost, 2)),
      },
      orderId: Number(order.id),
      clientKey: client ? `id:${client.id}` : `name:${String(order.market_name || order.client).trim().toLowerCase()}`,
      productKey: productKey || `name:${String(item.product_name ?? "").trim().toLowerCase()}`,
      valued: qty * price > 0,
      qty,
      retQty,
      currency: appCurrency || currency,
      ordAmount: qty * price * toBase,
      retAmount: retQty * price * toBase,
      docAmount: qty * price * toDoc,
      docRetAmount: retQty * price * toDoc,
      ordCost: qty * unitCost,
      retCost: retQty * unitCost,
      blockQty: box > 0 ? qty / box : 0,
      bonusQty: bonus ? qty : 0,
      bonusRet: bonus ? retQty : 0,
      weight: qty * weight,
    })
  }
  return { records, base: shown.code, missingRates: [...missing].sort() }
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
      // An individual filter ("ДОБАВИТЬ ИНДИВИДУАЛЬНЫЙ ФИЛЬТР"): "*<grouping>" → the grouping's value contains the text.
      if (label.startsWith(CUSTOM_FILTER)) {
        const text = (rec.group[label.slice(CUSTOM_FILTER.length)] ?? "").toLocaleLowerCase("ru")
        return text.includes(value.trim().toLocaleLowerCase("ru"))
      }
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

  const label = (rec: SalesRec | VisitRec, name: string) => rec.group[name] || NOT_SET
  // Sort keys: a date grouping sorts by its ISO day ("~<name>"), anything else by its shown name.
  const sortKey = (rec: SalesRec | VisitRec, name: string) => rec.group["~" + name] || label(rec, name)
  const rowsMap = new Map<string, { labels: string[]; sort: string[]; cells: Map<string, Acc>; all: Acc }>()
  const colSort = new Map<string, string[]>()
  const totalAcc = new Map<string, Acc>()
  const grandAcc = newAcc()
  const accumulate = (acc: Acc, rec: SalesRec | VisitRec) => (sales ? accumulateSales(acc, rec as SalesRec) : accumulateVisit(acc, rec as VisitRec))
  for (const rec of filtered) {
    const rowLabels = vertical.map((name) => label(rec, name))
    const rowKey = rowLabels.join("\u0001")
    const colKey = horizontal.map((name) => label(rec, name)).join(" / ")
    if (!colSort.has(colKey)) colSort.set(colKey, horizontal.map((name) => sortKey(rec, name)))
    const row = rowsMap.get(rowKey) ?? { labels: rowLabels, sort: vertical.map((name) => sortKey(rec, name)), cells: new Map<string, Acc>(), all: newAcc() }
    rowsMap.set(rowKey, row)
    const cell = row.cells.get(colKey) ?? newAcc()
    row.cells.set(colKey, cell)
    accumulate(cell, rec)
    const total = totalAcc.get(colKey) ?? newAcc()
    totalAcc.set(colKey, total)
    accumulate(total, rec)
    if (horizontal.length) {
      accumulate(row.all, rec)
      accumulate(grandAcc, rec)
    }
  }

  const colKeys = [...colSort.keys()].sort((a, b) => compareKeys(colSort.get(a) ?? [], colSort.get(b) ?? []))
  const measure = (acc: Acc | undefined, column: string) =>
    acc ? (sales ? salesMeasure(acc, column) : visitMeasure(acc, column)) : sales ? 0 : column.includes("активность") ? "" : 0
  const headers = [...vertical, ...colKeys.flatMap((key) => columns.map((column) => (horizontal.length && key ? `${key} · ${column}` : column)))]
  const sorted = [...rowsMap.values()].sort((a, b) => compareKeys(a.sort, b.sort))
  const rows = sorted.map((row) => [...row.labels, ...colKeys.flatMap((key) => columns.map((column) => measure(row.cells.get(key), column)))])
  const totals = input.showTotals === false ? null : [...vertical.map((_, index) => (index === 0 ? "Итого" : "")), ...colKeys.flatMap((key) => columns.map((column) => measure(totalAcc.get(key), column)))]
  const result: BuilderResult = { headers, rows, totals, unsupported: [...unsupported], count: filtered.length, vertical, keys: colKeys, columns }
  if (horizontal.length) {
    result.rowTotals = sorted.map((row) => columns.map((column) => measure(row.all, column)))
    result.grandTotals = columns.map((column) => measure(grandAcc, column))
  }
  if (!salesData) return result
  const documentColumns = columns.filter((column) => DOCUMENT_MONEY_COLUMNS.has(column))
  return { ...result, currency: salesData.base, missingRates: salesData.missingRates, documentColumns }
}

/** The name of an empty grouping value, as the reference prints it. */
const NOT_SET = "Не указано"
/** Prefix of an individual filter's key: "*<grouping>" = the grouping's value contains the filter text. */
const CUSTOM_FILTER = "*"
const NUMERIC = /^-?\d+(?:[.,]\d+)?$/
/** The reference's order (pandas): numbers by value, texts by their characters (Latin before Cyrillic). */
function compareLabel(a: string, b: string): number {
  if (NUMERIC.test(a) && NUMERIC.test(b)) return Number(a.replace(",", ".")) - Number(b.replace(",", "."))
  return a < b ? -1 : a > b ? 1 : 0
}
function compareKeys(a: string[], b: string[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const order = compareLabel(a[index] ?? "", b[index] ?? "")
    if (order) return order
  }
  return 0
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
