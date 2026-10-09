import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { supplyCostLines, type Incoming, type IncomingExpense, type IncomingItem, type IncomingLog } from "@/components/analytics/supplier-incomings-data"
import type { SupplyPaymentsResult } from "@/components/analytics/supplier-payments-data"
import { listSupplyPayments, paidBySupply } from "@/lib/cash/supplier-payments"
import { ensureCashSchema } from "@/lib/cash/schema"

// Supplier incomings ("Приход от поставщиков"). A supply is created
// "ожидает", is accepted onto the warehouse ("принят") or cancelled
// ("отменен"); acceptance can be undone while nothing else depends on it.
// Accepted supplies drive product net costs (Формирование цен) and stock.

declare global {
  var __linkoIncomingsSchemaReady: Promise<void> | undefined
}

async function ensureSchema(db: PgDb) {
  if (!globalThis.__linkoIncomingsSchemaReady) {
    globalThis.__linkoIncomingsSchemaReady = (async () => {
      await db.exec(`
        ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'SUM';
        ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS invoice_date TEXT NOT NULL DEFAULT '';
        ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS accepted_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS accepted_by TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS initial_cost REAL;

        CREATE TABLE IF NOT EXISTS supplier_incoming_expenses (
          id SERIAL PRIMARY KEY,
          incoming_id INTEGER NOT NULL REFERENCES supplier_incomings(id) ON DELETE CASCADE,
          date TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          amount REAL NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'SUM',
          payment_type TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS supplier_incoming_logs (
          id SERIAL PRIMARY KEY,
          incoming_id INTEGER NOT NULL REFERENCES supplier_incomings(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '',
          user_name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT ''
        );
      `)
    })().catch((error) => {
      globalThis.__linkoIncomingsSchemaReady = undefined
      throw error
    })
  }
  await globalThis.__linkoIncomingsSchemaReady
}

/** For other modules reading the incoming tables (production stock). */
export async function ensureIncomingsSchema() {
  await ensureSchema(getDb())
}

async function incomingsDb(): Promise<PgDb> {
  const db = getDb()
  await ensureSchema(db)
  // "Оплачено" reads supplier_payments (cash core columns); installing that schema
  // here, before any transaction below, keeps its DDL out of locked sections.
  await ensureCashSchema(db)
  return db
}

type Row = {
  id: number
  supplier: string
  warehouse: string
  date: string
  payment_type: string
  contract_number: string
  amount: number
  status: string
  invoice_number: string
  organization: string
  branch: string
  phone: string
  email: string
  initiator: string
  paid: number
  time: string
  comment: string
  items: string
  currency: string
  invoice_date: string
  accepted_at: string
  accepted_by: string
  expenses_total: number | null
}

function parseItems(value: string): IncomingItem[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as IncomingItem[]) : []
  } catch {
    return []
  }
}

function rowToIncoming(row: Row): Incoming {
  return {
    id: row.id,
    supplier: row.supplier,
    warehouse: row.warehouse,
    date: row.date,
    paymentType: row.payment_type as Incoming["paymentType"],
    contractNumber: row.contract_number,
    amount: row.amount,
    status: row.status as Incoming["status"],
    invoiceNumber: row.invoice_number,
    organization: row.organization,
    branch: row.branch,
    phone: row.phone,
    email: row.email,
    initiator: row.initiator,
    paid: row.paid,
    time: row.time,
    comment: row.comment,
    items: parseItems(row.items),
    currency: row.currency || "SUM",
    invoiceDate: row.invoice_date,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    expensesTotal: Number(row.expenses_total) || 0,
  }
}

const SELECT = `
  SELECT i.*, (SELECT SUM(e.amount) FROM supplier_incoming_expenses e WHERE e.incoming_id = i.id) AS expenses_total
  FROM supplier_incomings i`

const monthNames = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
function formatToday() {
  const date = new Date()
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

export type IncomingInput = {
  supplier: string
  warehouse: string
  branch: string
  organization: string
  paymentType: Incoming["paymentType"]
  currency: string
  date: string
  contractNumber: string
  invoiceNumber: string
  invoiceDate: string
  comment: string
  items: IncomingItem[]
}

export function parseIncomingInput(body: unknown): IncomingInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const supplier = typeof value.supplier === "string" ? value.supplier.trim() : ""
  const warehouse = typeof value.warehouse === "string" ? value.warehouse.trim() : ""
  const items = Array.isArray(value.items) ? (value.items as IncomingItem[]) : []
  if (!supplier || !warehouse || items.length === 0) return null
  const paymentTypeValue = typeof value.paymentType === "string" ? value.paymentType : "Банковский счет"
  return {
    supplier,
    warehouse,
    branch: typeof value.branch === "string" ? value.branch : "",
    organization: typeof value.organization === "string" ? value.organization : "",
    paymentType: (["Банковский счет", "Наличный"].includes(paymentTypeValue) ? paymentTypeValue : "Банковский счет") as Incoming["paymentType"],
    currency: typeof value.currency === "string" && value.currency.trim() ? value.currency.trim() : "SUM",
    date: typeof value.date === "string" && value.date ? value.date : formatToday(),
    contractNumber: typeof value.contractNumber === "string" ? value.contractNumber : "",
    invoiceNumber: typeof value.invoiceNumber === "string" ? value.invoiceNumber : "",
    invoiceDate: typeof value.invoiceDate === "string" ? value.invoiceDate : "",
    comment: typeof value.comment === "string" ? value.comment : "",
    items: items
      .filter((item) => String(item.product ?? "").trim())
      .map((item, index) => ({
        id: Number(item.id) || index + 1,
        product: String(item.product ?? "").trim(),
        expiry: String(item.expiry ?? ""),
        qty: Number(item.qty) || 0,
        block: Number(item.block) || 0,
        kg: Number(item.kg) || 0,
        netWeight: Number(item.netWeight) || 0,
        cost: Number(item.cost) || 0,
        total: (Number(item.qty) || 0) * (Number(item.cost) || 0),
      })),
  }
}

function amountOf(input: IncomingInput) {
  return input.items.reduce((sum, item) => sum + item.qty * item.cost, 0)
}

/** Phone / e-mail shown on the supply come from the supplier's first contact. */
async function supplierContact(db: PgDb, supplier: string) {
  const row = (await db.prepare("SELECT contacts FROM suppliers WHERE name = ? ORDER BY id DESC LIMIT 1").get(supplier)) as { contacts: string } | undefined
  try {
    const contact = (JSON.parse(row?.contacts ?? "[]") as Array<{ phone?: string; email?: string }>)[0]
    return { phone: contact?.phone?.trim() || "Не указан", email: contact?.email?.trim() || "Не указан" }
  } catch {
    return { phone: "Не указан", email: "Не указан" }
  }
}

async function addLog(db: PgDb, incomingId: number, action: string, userName: string, details = "") {
  await db
    .prepare("INSERT INTO supplier_incoming_logs (incoming_id, action, details, user_name, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(incomingId, action, details, userName, new Date().toISOString())
}

/** "Оплачено" = live verified supplier payments linked to the supply (cash page «Расход»
 * with a supply), in the supply currency; the legacy `paid` column is not read. */
function withPaid(incoming: Incoming, paid: Map<number, number>): Incoming {
  return { ...incoming, paid: paid.get(incoming.id) ?? 0 }
}

export async function listIncomings(): Promise<Incoming[]> {
  const db = await incomingsDb()
  const rows = ((await db.prepare(`${SELECT} ORDER BY i.id DESC`).all()) as Row[]).map(rowToIncoming)
  const paid = await paidBySupply(null, db)
  return rows.map((row) => withPaid(row, paid))
}

export async function getIncoming(id: number, db?: PgDb): Promise<Incoming | null> {
  const executor = db ?? (await incomingsDb())
  const row = (await executor.prepare(`${SELECT} WHERE i.id = ?`).get(id)) as Row | undefined
  return row ? withPaid(rowToIncoming(row), await paidBySupply([id], executor)) : null
}

/** "Список оплат по поставке №N" (supply card «Оплачено» link); null = no such supply. */
export async function listIncomingPayments(id: number): Promise<SupplyPaymentsResult | null> {
  const db = await incomingsDb()
  return listSupplyPayments(id, db)
}

export async function createIncoming(input: IncomingInput, userName: string): Promise<Incoming> {
  const db = await incomingsDb()
  const contact = await supplierContact(db, input.supplier)
  return withTransaction(async (tx) => {
    const result = await tx
      .prepare(
        `INSERT INTO supplier_incomings (
          supplier, warehouse, date, payment_type, contract_number, amount, status, invoice_number,
          organization, branch, phone, email, initiator, paid, time, comment, items, currency, invoice_date, updated_at
        ) VALUES (
          @supplier, @warehouse, @date, @paymentType, @contractNumber, @amount, 'ожидает', @invoiceNumber,
          @organization, @branch, @phone, @email, @initiator, 0, @time, @comment, @items, @currency, @invoiceDate, datetime('now')
        )`,
      )
      .run({
        supplier: input.supplier,
        warehouse: input.warehouse,
        date: input.date,
        paymentType: input.paymentType,
        contractNumber: input.contractNumber,
        amount: amountOf(input),
        invoiceNumber: input.invoiceNumber,
        organization: input.organization,
        branch: input.branch,
        phone: contact.phone,
        email: contact.email,
        initiator: userName,
        time: `${input.date}, ${new Date().toTimeString().slice(0, 5)}`,
        comment: input.comment,
        items: JSON.stringify(input.items),
        currency: input.currency,
        invoiceDate: input.invoiceDate,
      })
    await addLog(tx, result.lastInsertRowid, "created", userName)
    return (await getIncoming(result.lastInsertRowid, tx))!
  })
}

export type IncomingChange = Incoming | "not_found" | "locked"

/** Only a supply that hasn't reached the warehouse yet can be edited. */
export async function updateIncoming(id: number, input: IncomingInput, userName: string): Promise<IncomingChange> {
  const db = await incomingsDb()
  const contact = await supplierContact(db, input.supplier)
  return withTransaction(async (tx) => {
    const current = await lockIncoming(tx, id)
    if (!current) return "not_found"
    if (current.status !== "ожидает") return "locked"
    await tx
      .prepare(
        `UPDATE supplier_incomings SET
           supplier = @supplier, warehouse = @warehouse, date = @date, payment_type = @paymentType,
           contract_number = @contractNumber, amount = @amount, invoice_number = @invoiceNumber,
           organization = @organization, branch = @branch, phone = @phone, email = @email, comment = @comment,
           items = @items, currency = @currency, invoice_date = @invoiceDate, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        supplier: input.supplier,
        warehouse: input.warehouse,
        date: input.date,
        paymentType: input.paymentType,
        contractNumber: input.contractNumber,
        amount: amountOf(input),
        invoiceNumber: input.invoiceNumber,
        organization: input.organization,
        branch: input.branch,
        phone: contact.phone,
        email: contact.email,
        comment: input.comment,
        items: JSON.stringify(input.items),
        currency: input.currency,
        invoiceDate: input.invoiceDate,
      })
    await addLog(tx, id, "updated", userName)
    return (await getIncoming(id, tx))!
  })
}

async function lockIncoming(db: PgDb, id: number): Promise<Incoming | null> {
  const row = (await db.prepare("SELECT id FROM supplier_incomings WHERE id = ? FOR UPDATE").get(id)) as { id: number } | undefined
  return row ? getIncoming(id, db) : null
}

export async function deleteIncoming(id: number): Promise<"ok" | "not_found" | "locked"> {
  const db = await incomingsDb()
  const current = await getIncoming(id, db)
  if (!current) return "not_found"
  if (current.status === "принят") return "locked"
  await db.prepare("DELETE FROM supplier_incomings WHERE id = ?").run(id)
  return "ok"
}

export type StatusAction = "accept" | "unaccept" | "cancel"

const TRANSITIONS: Record<StatusAction, { from: Incoming["status"]; to: Incoming["status"] }> = {
  accept: { from: "ожидает", to: "принят" },
  unaccept: { from: "принят", to: "ожидает" },
  cancel: { from: "ожидает", to: "отменен" },
}

/** "Принять на склад" / "Отменить приемку" / "Отменить". Accepting puts the
 * goods on the warehouse and into the products' net cost. */
export async function changeIncomingStatus(id: number, action: StatusAction, userName: string): Promise<IncomingChange> {
  await incomingsDb()
  const transition = TRANSITIONS[action]
  return withTransaction(async (tx) => {
    const current = await lockIncoming(tx, id)
    if (!current) return "not_found"
    if (current.status !== transition.from) return "locked"
    const acceptedAt = action === "accept" ? new Date().toISOString() : ""
    const acceptedBy = action === "accept" ? userName : ""
    await tx
      .prepare("UPDATE supplier_incomings SET status = ?, accepted_at = ?, accepted_by = ?, updated_at = datetime('now') WHERE id = ?")
      .run(transition.to, acceptedAt, acceptedBy, id)
    await addLog(tx, id, action === "accept" ? "accepted" : action === "unaccept" ? "unaccepted" : "cancelled", userName)
    if (action !== "cancel") await recalcProductCosts(tx, current.items.map((item) => item.product))
    return (await getIncoming(id, tx))!
  })
}

// ---------------------------------------------------------------------------
// Additional costs and net cost
// ---------------------------------------------------------------------------

type ExpenseRow = {
  id: number
  incoming_id: number
  date: string
  description: string
  amount: number
  currency: string
  payment_type: string
  created_by: string
  created_at: string
}

const toExpense = (row: ExpenseRow): IncomingExpense => ({
  id: row.id,
  incomingId: row.incoming_id,
  date: row.date,
  description: row.description,
  amount: row.amount,
  currency: row.currency,
  paymentType: row.payment_type,
  createdBy: row.created_by,
  createdAt: row.created_at,
})

export async function listIncomingExpenses(incomingId: number): Promise<IncomingExpense[]> {
  const db = await incomingsDb()
  return ((await db.prepare("SELECT * FROM supplier_incoming_expenses WHERE incoming_id = ? ORDER BY id").all(incomingId)) as ExpenseRow[]).map(toExpense)
}

export type ExpenseInput = { date: string; description: string; amount: number; currency: string; paymentType: string }

export async function addIncomingExpense(incomingId: number, input: ExpenseInput, userName: string): Promise<IncomingChange> {
  await incomingsDb()
  return withTransaction(async (tx) => {
    const current = await lockIncoming(tx, incomingId)
    if (!current) return "not_found"
    if (current.status === "отменен") return "locked"
    await tx
      .prepare(
        `INSERT INTO supplier_incoming_expenses (incoming_id, date, description, amount, currency, payment_type, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(incomingId, input.date, input.description, input.amount, input.currency, input.paymentType, userName, new Date().toISOString())
    await addLog(tx, incomingId, "expense_added", userName, `${input.description}: ${input.amount} ${input.currency}`)
    if (current.status === "принят") await recalcProductCosts(tx, current.items.map((item) => item.product))
    return (await getIncoming(incomingId, tx))!
  })
}

export async function deleteIncomingExpense(incomingId: number, expenseId: number, userName: string): Promise<IncomingChange> {
  await incomingsDb()
  return withTransaction(async (tx) => {
    const current = await lockIncoming(tx, incomingId)
    if (!current) return "not_found"
    const expense = (await tx.prepare("SELECT * FROM supplier_incoming_expenses WHERE id = ? AND incoming_id = ?").get(expenseId, incomingId)) as
      | ExpenseRow
      | undefined
    if (!expense) return "not_found"
    await tx.prepare("DELETE FROM supplier_incoming_expenses WHERE id = ?").run(expenseId)
    await addLog(tx, incomingId, "expense_deleted", userName, `${expense.description}: ${expense.amount} ${expense.currency}`)
    if (current.status === "принят") await recalcProductCosts(tx, current.items.map((item) => item.product))
    return (await getIncoming(incomingId, tx))!
  })
}

export type SupplyHistoryLine = { incomingId: number; date: string; acceptedAt: string; qty: number; unitCost: number; averageCost: number }

/** Accepted supplies of one product, oldest first, with the running
 * quantity-weighted average cost after each of them. */
export async function productSupplyHistory(productName: string, db?: PgDb): Promise<SupplyHistoryLine[]> {
  const executor = db ?? (await incomingsDb())
  const rows = (await executor
    .prepare(`${SELECT} WHERE i.status = 'принят' AND i.items LIKE ? ORDER BY i.accepted_at, i.id`)
    .all(`%${JSON.stringify(productName).slice(1, -1)}%`)) as Row[]
  const key = productName.trim().toLocaleLowerCase("ru")
  const history: SupplyHistoryLine[] = []
  let qty = 0
  let value = 0
  for (const row of rows) {
    const incoming = rowToIncoming(row)
    for (const line of supplyCostLines(incoming)) {
      if (line.product.trim().toLocaleLowerCase("ru") !== key || !(line.qty > 0)) continue
      qty += line.qty
      value += line.qty * line.unitCost
      history.push({ incomingId: incoming.id, date: incoming.date, acceptedAt: incoming.acceptedAt, qty: line.qty, unitCost: line.unitCost, averageCost: value / qty })
    }
  }
  return history
}

/** Net cost of a product = average cost of its accepted supplies; with no
 * accepted supply it falls back to the product's initial (default) cost. */
export async function recalcProductCosts(db: PgDb, productNames: string[]) {
  for (const name of Array.from(new Set(productNames.map((value) => value.trim()).filter(Boolean)))) {
    const product = (await db.prepare("SELECT id, cost, initial_cost FROM products WHERE name = ?").get(name)) as
      | { id: number; cost: number; initial_cost: number | null }
      | undefined
    if (!product) continue
    const history = await productSupplyHistory(name, db)
    const initial = product.initial_cost ?? product.cost
    const cost = history.length ? history[history.length - 1].averageCost : initial
    await db.prepare("UPDATE products SET initial_cost = ?, cost = ? WHERE id = ?").run(initial, Math.round(cost * 1e6) / 1e6, product.id)
  }
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export async function listIncomingLogs(incomingId: number): Promise<IncomingLog[]> {
  const db = await incomingsDb()
  const rows = (await db.prepare("SELECT * FROM supplier_incoming_logs WHERE incoming_id = ? ORDER BY id DESC").all(incomingId)) as Array<{
    id: number
    action: string
    details: string
    user_name: string
    created_at: string
  }>
  return rows.map((row) => ({ id: row.id, action: row.action, details: row.details, userName: row.user_name, createdAt: row.created_at }))
}

// ---------------------------------------------------------------------------
// Наценка (repricing from a supply)
// ---------------------------------------------------------------------------

export type RepriceInput = { priceListId: number; currency: string; comment: string; prices: Array<{ product: string; price: number }> }

type PriceEntry = { name: string; cash: number; nonCash: number; min: number; max: number; currency?: string; nonCashCurrency?: string }

const priceMonths = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** Writes the calculated selling prices into the chosen price list of each
 * product and records them as repricing (Переоценка) documents. */
export async function repriceFromIncoming(incomingId: number, input: RepriceInput, userName: string): Promise<{ updated: number; missing: string[] } | "not_found" | "price_list_not_found"> {
  await incomingsDb()
  return withTransaction(async (tx) => {
    const incoming = await lockIncoming(tx, incomingId)
    if (!incoming) return "not_found"
    const priceList = (await tx.prepare("SELECT id, name FROM price_lists WHERE id = ?").get(input.priceListId)) as { id: number; name: string } | undefined
    if (!priceList) return "price_list_not_found"
    const now = new Date()
    const label = `${String(now.getDate()).padStart(2, "0")} ${priceMonths[now.getMonth()]} ${now.getFullYear()}`
    const missing: string[] = []
    let updated = 0
    for (const line of input.prices) {
      if (!(line.price >= 0)) continue
      const product = (await tx.prepare("SELECT id, price_lists FROM products WHERE name = ?").get(line.product)) as
        | { id: number; price_lists: string }
        | undefined
      if (!product) {
        missing.push(line.product)
        continue
      }
      let entries: PriceEntry[] = []
      try {
        entries = JSON.parse(product.price_lists) as PriceEntry[]
      } catch {
        entries = []
      }
      const entry = entries.find((item) => item.name === priceList.name)
      if (entry) Object.assign(entry, { cash: line.price, nonCash: line.price, currency: input.currency, nonCashCurrency: input.currency })
      else entries.push({ name: priceList.name, cash: line.price, nonCash: line.price, min: 0, max: 0, currency: input.currency, nonCashCurrency: input.currency })
      const prices = entries.flatMap((item) => [item.cash, item.nonCash]).filter((value) => value > 0)
      await tx
        .prepare("UPDATE products SET price_lists = ?, price_min = ?, price_max = ?, price_updated_date = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(entries), prices.length ? Math.min(...prices) : 0, prices.length ? Math.max(...prices) : 0, label, product.id)
      await tx
        .prepare(
          `INSERT INTO repricings (created_by, created_at_label, price_list_id, product_id, amount, currency, status, "user")
           VALUES (?, ?, ?, ?, ?, ?, 'проведен', ?)`,
        )
        .run(userName, label, priceList.id, product.id, line.price, input.currency, userName)
      updated += 1
    }
    await addLog(tx, incomingId, "repriced", userName, `${priceList.name}: ${updated}${input.comment ? ` — ${input.comment}` : ""}`)
    return { updated, missing }
  })
}

// ---------------------------------------------------------------------------
// Формирование цен: a product's net cost
// ---------------------------------------------------------------------------

export type ProductCostInfo = { initialCost: number; currentCost: number; history: SupplyHistoryLine[] }

export async function getProductCostInfo(productId: number): Promise<ProductCostInfo | null> {
  const db = await incomingsDb()
  const product = (await db.prepare("SELECT name, cost, initial_cost FROM products WHERE id = ?").get(productId)) as
    | { name: string; cost: number; initial_cost: number | null }
    | undefined
  if (!product) return null
  const history = await productSupplyHistory(product.name, db)
  return { initialCost: product.initial_cost ?? product.cost, currentCost: product.cost, history }
}

/** "Себестоимость по умолчанию": the cost used until the first accepted
 * supply; the current net cost is recalculated from it. */
export async function setProductInitialCost(productId: number, initialCost: number): Promise<ProductCostInfo | null> {
  const db = await incomingsDb()
  const product = (await db.prepare("SELECT name FROM products WHERE id = ?").get(productId)) as { name: string } | undefined
  if (!product) return null
  await withTransaction(async (tx) => {
    await tx.prepare("UPDATE products SET initial_cost = ? WHERE id = ?").run(initialCost, productId)
    await recalcProductCosts(tx, [product.name])
  })
  return getProductCostInfo(productId)
}
