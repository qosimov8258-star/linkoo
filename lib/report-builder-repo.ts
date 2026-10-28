import "server-only"

import { clientDays } from "@/lib/agent-visits-repo"
import { getDb } from "@/lib/db"
import { listFieldEmployees } from "@/lib/field-activity/employees"
import { selectedBranchName } from "@/lib/selected-branch"

// Engine behind the "Отчет по продажам" and "Конструктор" (visits) report builders: the page sends the chosen columns,
// vertical / horizontal groupings and filters; the rows are aggregated here from the real orders / visits instead of
// being faked on the client. Names that have no data source locally are reported back in `unsupported` (their cells
// stay empty) so the page can say so instead of printing made-up numbers. The visits come from the field activity data
// (planned routes + visits of the mobile app), the one source of Активность / Отслеживание.

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
}
export type BuilderResult = {
  headers: string[]
  /** one entry per header: group columns first, then (horizontal key ×) measure columns */
  rows: (string | number)[][]
  totals: (string | number)[] | null
  unsupported: string[]
  count: number
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

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

/** "18 авг. 2026" / "04 сент. 17:58" → ISO date, using `fallback` for the year/when unparsable. */
function isoFromRussian(text: string, fallback: string) {
  const match = text.trim().toLowerCase().match(/^(\d{1,2})\s+([а-я]+)\.?(?:\s+(\d{4}))?/)
  if (!match) return fallback.slice(0, 10)
  const month = SHORT.findIndex((item) => match[2].startsWith(item.slice(0, 3)))
  if (month < 0) return fallback.slice(0, 10)
  const year = match[3] ?? fallback.slice(0, 4)
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`
}

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
  qty: number
  retQty: number
  ordAmount: number
  retAmount: number
  ordCost: number
  retCost: number
  rate: number
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

function salesMeasure(acc: Acc, column: string): number {
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
    case "Сумма заказов": case "Сумма до переоценки заказов": return round(sum(acc, "a"))
    case "Сумма возвратов": case "Сумма до переоценки возвратов": return round(sum(acc, "ar"))
    case "Сумма факт": case "Сумма до переоценки факт": return round(sum(acc, "a") - sum(acc, "ar"))
    case "Сумма заказов, SUM": return round(sum(acc, "as"))
    case "Сумма возвратов, SUM": return round(sum(acc, "ars"))
    case "Сумма факт, SUM": return round(sum(acc, "as") - sum(acc, "ars"))
    case "Себестоимость заказа": return round(sum(acc, "c"))
    case "Себестоимость возврата": return round(sum(acc, "cr"))
    case "Cебестоимость факт": return round(sum(acc, "c") - sum(acc, "cr"))
    case "Прибыль от продаж": return round(sum(acc, "a") - sum(acc, "ar") - (sum(acc, "c") - sum(acc, "cr")))
    case "Наценка Заказа (%)": return sum(acc, "c") > 0 ? round(((sum(acc, "a") - sum(acc, "c")) / sum(acc, "c")) * 100, 2) : 0
    case "Ассортимент": return card(acc, "products")
    default: return 0
  }
}

async function loadSales(input: BuilderInput) {
  const db = getDb()
  const branch = await selectedBranchName()
  const dayOfOrder = (order: { created_at: string; delivery: string }) => (input.tab?.includes("СОЗДАНИЮ") ? order.created_at.slice(0, 10) : isoFromRussian(order.delivery ?? "", order.created_at))
  const orders = (await db
    .prepare(
      `SELECT id, client, market_name, zone, agent, delivery_man, expeditor, organization, price_list, stock_name, branch_name, pay_type_name, deal_type, status, created_at, delivery
       FROM orders WHERE status <> 'Отменен' AND substr(created_at, 1, 4) >= '2000' AND (?::text = '' OR branch_name = ?)`,
    )
    .all(branch, branch)) as Record<string, string>[]
  const inRange = orders.filter((order) => {
    const day = dayOfOrder({ created_at: order.created_at, delivery: order.delivery })
    return day >= input.from && day <= input.to
  })
  const ids = new Set(inRange.map((order) => Number(order.id)))
  const items = ((await db
    .prepare(
      `SELECT i.id, i.order_id, i.product_id, i.product_name, i.unit, i.quantity, i.unit_price, i.cost_price, i.discount_percent, i.currency, i.return_quantity,
              p.brand, p.type AS product_type, p.article, p.integration_code, p.barcode, p.box_amount, p.weight, p.order_number,
              CASE WHEN b.order_item_id IS NULL THEN 0 ELSE 1 END AS is_bonus
       FROM order_items i LEFT JOIN products p ON p.id = i.product_id LEFT JOIN order_item_bonus b ON b.order_item_id = i.id`,
    )
    .all()) as Record<string, string | number>[]).filter((item) => ids.has(Number(item.order_id)))
  const clients = (await db.prepare("SELECT id, name, inn, type, code, contact_person, agent, zone FROM clients").all()) as Record<string, string | number>[]
  const clientByName = new Map(clients.map((client) => [String(client.name).trim().toLowerCase(), client]))
  const currencies = (await db.prepare("SELECT name, rate FROM currencies").all()) as { name: string; rate: number }[]
  const rateOf = (code: string) => currencies.find((c) => c.name.toUpperCase() === (code || "SUM").toUpperCase())?.rate ?? 1
  const orderById = new Map(inRange.map((order) => [Number(order.id), order]))

  const records: SalesRec[] = []
  for (const item of items) {
    const order = orderById.get(Number(item.order_id))
    if (!order) continue
    const client = clientByName.get(String(order.market_name || order.client).trim().toLowerCase())
    const qty = num(item.quantity)
    const retQty = Math.min(qty, num(item.return_quantity))
    const price = num(item.unit_price) * (1 - num(item.discount_percent) / 100)
    const rate = rateOf(String(item.currency || "SUM"))
    const day = dayOfOrder({ created_at: order.created_at, delivery: order.delivery })
    const [first = "", ...rest] = String(order.agent ?? "").split(" ")
    const box = num(item.box_amount)
    const weight = num(item.weight)
    const bonus = Number(item.is_bonus) === 1
    records.push({
      group: {
        "~Дата по дням": day,
        "~Дата по неделям": isoWeekStart(day).toISOString().slice(0, 10),
        "~Дата по месяцам": day.slice(0, 7),
        "Дата по дням": dmy(day),
        "Дата по неделям": weekLabel(day),
        "Дата по месяцам": monthLabel(day),
        "Валюта": String(item.currency || "SUM"),
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
        "Себестоимость": String(round(num(item.cost_price), 2)),
      },
      orderId: Number(order.id),
      clientKey: String(order.market_name || order.client),
      productKey: String(item.product_id ?? item.product_name),
      qty,
      retQty,
      ordAmount: qty * price,
      retAmount: retQty * price,
      ordCost: qty * num(item.cost_price),
      retCost: retQty * num(item.cost_price),
      rate,
      blockQty: box > 0 ? qty / box : 0,
      bonusQty: bonus ? qty : 0,
      bonusRet: bonus ? retQty : 0,
      weight: qty * weight,
    })
  }
  return records
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
  add(acc, "as", rec.ordAmount * rec.rate); add(acc, "ars", rec.retAmount * rec.rate)
  add(acc, "c", rec.ordCost); add(acc, "cr", rec.retCost)
  add(acc, "b", rec.blockQty); add(acc, "br", rec.qty > 0 ? rec.blockQty * (rec.retQty / rec.qty) : 0)
  add(acc, "bn", rec.bonusQty); add(acc, "bnr", rec.bonusRet)
  add(acc, "w", rec.weight); add(acc, "wr", rec.qty > 0 ? rec.weight * (rec.retQty / rec.qty) : 0)
  addSet(acc, "orders", rec.orderId)
  if (rec.retQty > 0) addSet(acc, "returns", rec.orderId)
  if (rec.ordAmount > 0) addSet(acc, "clients", rec.clientKey)
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
 * source as Активность / Отслеживание: lib/agent-visits-repo.ts clientDays. */
async function loadVisits(input: BuilderInput) {
  const days = await clientDays(input.from, input.to)
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
  const records = (sales ? await loadSales(input) : await loadVisits(input)) as (SalesRec | VisitRec)[]

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
  const measure = (acc: Acc | undefined, column: string) => (acc ? (sales ? salesMeasure(acc, column) : visitMeasure(acc, column)) : sales ? 0 : column.includes("активность") ? "" : 0)
  const headers = [...vertical, ...colKeys.flatMap((key) => columns.map((column) => (horizontal.length && key ? `${key} · ${column}` : column)))]
  const rows = [...rowsMap.values()]
    .sort((a, b) => a.sort.localeCompare(b.sort, "ru", { numeric: true }))
    .map((row) => [...row.labels, ...colKeys.flatMap((key) => columns.map((column) => measure(row.cells.get(key), column)))])
  const totals = input.showTotals === false ? null : [...vertical.map((_, index) => (index === 0 ? "Итого" : "")), ...colKeys.flatMap((key) => columns.map((column) => measure(totalAcc.get(key), column)))]
  return { headers, rows, totals, unsupported: [...unsupported], count: filtered.length }
}

/** Distinct values per filter label for the filter selects of the page. */
export async function builderFilterOptions(kind: BuilderKind): Promise<Record<string, string[]>> {
  const db = getDb()
  const distinct = async (sql: string) => ((await db.prepare(sql).all()) as { v: string }[]).map((row) => row.v).filter(Boolean)
  if (kind === "visits") {
    // The employees and the zones of the directory (Клиенты → зоны), like the field pages.
    return {
      "Пользователь": [...new Set((await listFieldEmployees({ activeOnly: true })).map((employee) => employee.name).filter(Boolean))],
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
