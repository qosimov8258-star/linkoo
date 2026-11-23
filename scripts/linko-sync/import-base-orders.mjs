// Продажи → Заказы, the BASE rows: the order headers of a Linko account under Linko's ids (orders.id = Linko's order
// id: the lines, the history, the returns, the payments and every later step find an order by it). The first copy got
// them from a one-off import long ago; on a new account's copy nothing else creates them, and import-orders.mjs (right
// after the base steps) only brings existing orders in line: status, warehouse, ship moment, client, debit flag,
// payment terms, author, comment, invoice, and the lines and history.
//
// What a header carries, in the form the first copy stores it (checked against it: every column below equals the first
// copy's rows for the orders that did not change in Linko since):
//   client        the account's name (Linko's `client`)       market_name   the shop's name (Linko's `market`)
//   zone / type   the shop's territory title / market type     product       the division's name (the old list column)
//   agent         who made the order (`user`)                   delivery_man / expeditor   their names
//   amount        total_price as "1 234 567,5 SUM" (two decimals at most, Linko's currency name)
//   delivery      date_delivery as "21 апр. 2026"               created       the list's moment "21 апр. 14:05", the year
//                                                                             only for another year than this one
//   created_at    the creation moment in UTC ("2026-04-21 09:05:00"; import-report-details.mjs writes the same)
//   total / return / fact price, weight, discount %, «Остаток» (total_balance), paid (card's total_paid), payment
//   method and name (custom_payment_type), due date (next payment date, else the payment date), deal and delivery
//   type, branch, price list, contract number, transport number, «Не правильный долг» (is_wrong_debt), the invoice
//   contract (Linko's object as JSON)
//   the client's debts the card printed when the order was downloaded (operative / actual debt and their currencies)
// A new order gets them all, plus the fields import-orders.mjs owns (status, client id, currency, warehouse,
// organization, payment type and day), so the row is whole even before that step runs. An existing order gets the
// columns that follow Linko's order (everything above except the creation moments, the list's `created` text and the
// debt snapshot, which stay as first written); a branch Linko leaves empty keeps the stored one (the app fills it).
// Each change is registered in linko_sync_rows with the previous values, so a second run changes nothing. An order of
// this copy that holds a Linko id but is another order (other shop and other day) stops the run before anything is
// written. `balance` / `negative` are the client's current ledger balance, computed by the app on every read: a new
// row stores the app's own empty values.
//
//   node scripts/linko-sync/import-base-orders.mjs   (raw: orders, orders_detail when downloaded; DRY=1 lists the
//                                                     changes and rolls back. The orders columns are the app's:
//                                                     prepare-target.ts creates them before the base steps)
import { bumpSequence, columnExists, connect, currencyCode, ensureRegistry, fullName, hasRaw, raw, runId, upsertById, utcIso } from "./lib.mjs"

const DRY = process.env.DRY === "1"
const STATUS = { 0: "В процессе", 1: "Есть на складе", 2: "В пути", 3: "Доставлено", 4: "Отменен", 5: "Не подтвержден" }
const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

const orders = [...raw("orders")].sort((a, b) => a.id - b.id)
const details = hasRaw("orders_detail") ? raw("orders_detail") : {}
const run = runId("base-orders")

const text = (value) => (value === null || value === undefined ? "" : String(value).trim())
const number = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value))
const thisYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric" }).format(new Date())
const moment = (value) => String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
/** Linko's order list moment: "21 апр. 14:05", with the year ("21 апр. 2025 14:05") for another year. */
function listMoment(value) {
  const m = moment(value)
  if (!m) return ""
  return `${m[3]} ${SHORT_MONTHS[Number(m[2]) - 1]}${m[1] === thisYear ? "" : ` ${m[1]}`} ${m[4] ?? "00"}:${m[5] ?? "00"}`
}
function shortDate(value) {
  const m = moment(value)
  return m ? `${m[3]} ${SHORT_MONTHS[Number(m[2]) - 1]} ${m[1]}` : ""
}
/** "1 234 567,5 SUM": Linko's total with two decimals at most, grouped as the app prints money, and the currency's name. */
function money(value, currency) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100
  const name = text(typeof currency === "object" ? currency?.name : currency) || currencyCode(currency)
  return `${rounded.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ")} ${name}`
}
const utcText = (value) => (value ? utcIso(value)?.slice(0, 19).replace("T", " ") ?? null : null)
const expand = (list) => (Array.isArray(list) ? JSON.stringify(list.map((item) => ({ currency: item.currency_name, amount: Number(item.amount) || 0 }))) : "")
const reference = (value, key) => (value && typeof value === "object" ? text(value[key]) : text(value))

/** The columns that follow Linko's order on every run. */
function followed(row, doc) {
  const market = row.market ?? doc.market ?? {}
  const pick = (key) => (row[key] !== undefined && row[key] !== null ? row[key] : doc[key])
  return {
    client: text(row.client?.name ?? doc.client?.name ?? market.name),
    zone: text(market.border?.title),
    type: text(market.market_type?.name),
    product: text((row.division ?? doc.division)?.name),
    delivery: shortDate(pick("date_delivery")),
    agent: fullName(row.user ?? doc.user),
    amount: money(pick("total_price"), row.currency ?? doc.currency),
    market_name: text(market.name),
    delivery_man: fullName(row.delivery_man ?? doc.delivery_man),
    expeditor: fullName(row.expeditor ?? doc.expeditor),
    total_price: number(pick("total_price")),
    return_price: number(row.total_return_price ?? doc.return_amount) ?? 0,
    fact_price: number(row.fact_price),
    weight: number(pick("total_weight")) ?? 0,
    discount_percent: number(pick("discount_percent")) ?? 0,
    pay_method: pick("payment_type") === "bank" ? "bank" : "cash",
    order_balance: number(pick("total_balance")),
    transport_number: reference(pick("transport"), "number"),
    price_list: text(doc.price_list?.name),
    paid_amount: number(doc.total_paid),
    deal_type: text(pick("deal_type")),
    delivery_type: text(doc.delivery_type),
    pay_type_name: text((row.custom_payment_type ?? doc.custom_payment_type)?.name),
    due_date: text(doc.next_payment_date ?? pick("payment_date")),
    wrong_debt: doc.is_wrong_debt ? 1 : 0,
    invoice_contract: doc.invoice_contract && typeof doc.invoice_contract === "object" ? JSON.stringify(doc.invoice_contract) : text(doc.invoice_contract),
    contract: reference(pick("contract"), "number"),
    ...(text(doc.branch?.name) ? { branch_name: text(doc.branch.name) } : {}),
  }
}

/** What only a new row gets: the creation moments, the debt snapshot, and import-orders.mjs's fields. */
function initial(row, doc) {
  const market = row.market ?? doc.market ?? {}
  const firstAccepted = Array.isArray(doc.market_accepted_balance) ? doc.market_accepted_balance[0] : null
  return {
    created: listMoment(row.created_date ?? doc.created_date),
    created_at: utcText(row.created_date ?? doc.created_date),
    balance: "",
    negative: 0,
    operative_debt: number(doc.total_balance_client ?? row.market_internal_balance),
    actual_debt: firstAccepted ? number(firstAccepted.amount) : null,
    operative_expand: expand(doc.total_balance_expand),
    actual_expand: expand(doc.market_accepted_balance),
    status: STATUS[Number(row.status ?? doc.status)] ?? STATUS[1],
    client_id: number(market.id),
    currency: currencyCode(row.currency ?? doc.currency),
    warehouse: text(doc.stock?.name),
    stock_name: text(doc.stock?.name),
    organization: text((row.division ?? doc.division)?.name),
    payment_type: row.payment_type === "bank" ? "bank" : "cash",
    payment_date: text(row.payment_date ?? doc.payment_date),
  }
}

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0, columns: {} }
try {
  const sample = { ...initial(orders[0] ?? {}, {}), ...followed(orders[0] ?? {}, {}), branch_name: "" }
  const missing = []
  for (const column of Object.keys(sample)) if (!(await columnExists(client, "orders", column))) missing.push(column)
  if (missing.length) throw new Error(`base orders: orders has no ${missing.join(", ")} yet: run prepare-target.ts first (the app's code creates them)`)

  await client.query("BEGIN")
  const stored = new Map((await client.query("SELECT id, client_id, created_at FROM orders")).rows.map((row) => [row.id, row]))
  // An order of this copy under a Linko id that is not that order: never overwritten.
  const foreign = []
  for (const row of orders) {
    const have = stored.get(row.id)
    if (!have) continue
    const doc = details[row.id] ?? {}
    const shop = number((row.market ?? doc.market)?.id)
    const day = String(utcText(row.created_date ?? doc.created_date) ?? "").slice(0, 10)
    const sameShop = have.client_id == null || shop == null || Number(have.client_id) === shop
    const sameDay = Math.abs(Date.parse(String(have.created_at ?? "").slice(0, 10)) - Date.parse(day)) <= 86_400_000
    if (!sameShop && !sameDay) foreign.push(row.id)
  }
  if (foreign.length) {
    throw new Error(
      `base orders: the orders ${foreign.join(", ")} of this copy hold Linko order ids but are other orders (another shop and day). ` +
        "Nothing written: move them to other ids first.",
    )
  }
  for (const row of orders) {
    const doc = details[row.id] ?? {}
    const values = followed(row, doc)
    if (!stored.has(row.id)) {
      stats[await upsertById(client, run, "orders", row.id, { ...initial(row, doc), ...values })]++
      continue
    }
    const before = (await client.query(`SELECT ${Object.keys(values).map((c) => `"${c}"`).join(", ")} FROM orders WHERE id = $1`, [row.id])).rows[0]
    const result = await upsertById(client, run, "orders", row.id, values)
    stats[result]++
    if (result === "update") {
      for (const [column, value] of Object.entries(values)) {
        if (String(before[column] ?? "") !== String(value ?? "")) stats.columns[column] = (stats.columns[column] ?? 0) + 1
      }
    }
  }
  await bumpSequence(client, "orders")
  await client.query(DRY ? "ROLLBACK" : "COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`base orders: ${orders.length} in Linko${DRY ? " (DRY, rolled back)" : ""} → ${JSON.stringify(stats)}`)
