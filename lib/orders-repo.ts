import { liveClientDebtLines } from "@/lib/client-live-balance"
import { selectedBranchName } from "@/lib/selected-branch"
import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { getBalanceList } from "@/lib/finance/ledger"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { keySql, nameKey } from "@/lib/platform-refs"
import { getStockBalances, getStockPending } from "@/lib/stock/ledger"
import { ensureStockSchema } from "@/lib/stock/schema"
import {
  EDITABLE_STATUSES,
  FINAL_STATUSES,
  ORDER_STATUSES,
  RELEASED_STATUSES,
  STOCK_STATUSES,
  canChangeStatus,
  type Order,
} from "@/components/orders/orders-data"

// Client orders (Продажи → Заказы).
//
// - An order belongs to a client by orders.client_id (contract 6); `client`
//   is the name snapshot. The client must exist.
// - An order has ONE currency (orders.currency); every line is in it. The
//   total (`amount`, "<sum> <CUR>") is derived from the lines; an order
//   without lines keeps a validated, non-negative amount (legacy money-only
//   orders). Deleting the last line resets it to 0.
// - Statuses and transitions: components/orders/orders-data.ts. Доставлено /
//   Отменен are final; lines can change only in Не подтвержден / В процессе /
//   Есть на складе.
// - Stock (contract 4): an order with lines in "Есть на складе" (reserved),
//   "В пути" / "Доставлено" (shipped) names its warehouse (orders.warehouse,
//   the warehouses.name). Entering such a status, changing the warehouse or a
//   line of a reserved order checks availability: on hand − reserved by other
//   orders (lib/stock/ledger.ts) must cover the order's quantity, else 409.
// - shipped_at (ISO, UTC "Z") is the moment the order left the warehouse;
//   the finance ledger dates realization by it.
// - Every change is logged in order_logs (the order card "Логи" tab).
// - `balance` / `negative` of a listed order are the client's CURRENT ledger
//   balance (lib/finance), never stored.

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const MAX_MONEY = 1e13
export const MAX_QTY = 1e9

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ORDER_COLUMNS: Array<[string, string]> = [
  ["payment_date", "TEXT NOT NULL DEFAULT ''"],
  ["payment_type", "TEXT NOT NULL DEFAULT ''"],
  ["organization", "TEXT NOT NULL DEFAULT ''"],
  ["warehouse", "TEXT NOT NULL DEFAULT ''"],
  ["delivery_man", "TEXT NOT NULL DEFAULT ''"],
  ["client_id", "INTEGER"],
  ["shipped_at", "TEXT"],
  ["currency", "TEXT NOT NULL DEFAULT ''"],
  ["price_list", "TEXT NOT NULL DEFAULT ''"],
  ["created_by", "TEXT NOT NULL DEFAULT ''"],
  ["comment", "TEXT NOT NULL DEFAULT ''"],
  ["delivery_type", "TEXT NOT NULL DEFAULT ''"],
  ["deal_type", "TEXT NOT NULL DEFAULT ''"],
  ["invoice_number", "TEXT NOT NULL DEFAULT ''"],
  ["invoice_date", "TEXT NOT NULL DEFAULT ''"],
  ["invoice_active", "INTEGER NOT NULL DEFAULT 0"],
  ["contract", "TEXT NOT NULL DEFAULT ''"],
  // Reference-order snapshot fields shown on the order card / debt pages.
  ["market_name", "TEXT NOT NULL DEFAULT ''"],
  ["expeditor", "TEXT NOT NULL DEFAULT ''"],
  ["accepted_date", "TEXT NOT NULL DEFAULT ''"],
  ["total_price", "DOUBLE PRECISION"],
  ["return_price", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["fact_price", "DOUBLE PRECISION"],
  ["weight", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["discount_percent", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["pay_method", "TEXT NOT NULL DEFAULT ''"],
  ["order_balance", "DOUBLE PRECISION"],
  ["transport_number", "TEXT NOT NULL DEFAULT ''"],
  ["branch_name", "TEXT NOT NULL DEFAULT ''"],
  ["stock_name", "TEXT NOT NULL DEFAULT ''"],
  ["paid_amount", "DOUBLE PRECISION"],
  ["operative_debt", "DOUBLE PRECISION"],
  ["actual_debt", "DOUBLE PRECISION"],
  ["pay_type_name", "TEXT NOT NULL DEFAULT ''"],
  ["due_date", "TEXT NOT NULL DEFAULT ''"],
  ["wrong_debt", "INTEGER NOT NULL DEFAULT 0"],
  ["invoice_contract", "TEXT NOT NULL DEFAULT ''"],
  ["operative_expand", "TEXT NOT NULL DEFAULT ''"],
  ["actual_expand", "TEXT NOT NULL DEFAULT ''"],
]

const DDL = `
${ORDER_COLUMNS.map(([name, type]) => `ALTER TABLE orders ADD COLUMN IF NOT EXISTS ${name} ${type};`).join("\n")}
CREATE INDEX IF NOT EXISTS orders_client_id_idx ON orders (client_id);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  product_name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'SUM',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);
-- Money precision (contract 3): older databases created these as REAL (float4).
DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['quantity', 'unit_price', 'cost_price', 'discount_percent'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'order_items' AND column_name = c AND data_type = 'real') THEN
      EXECUTE format('ALTER TABLE order_items ALTER COLUMN %I TYPE double precision USING round(%I::numeric, 6)::double precision', c, c);
    END IF;
  END LOOP;
END $$;
-- Lines belong to an existing order. NOT VALID: older databases may hold
-- orphan lines; the constraint still applies to every new or changed line.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_items'::regclass AND confrelid = 'orders'::regclass AND contype = 'f') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS order_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  amount TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS order_logs_order_idx ON order_logs (order_id);
`

const SCHEMA_VERSION = 2

declare global {
  var __linkoOrdersSchema: { version: number; ready: Promise<void> } | undefined
}

/** Order columns, order_items (double precision, FK) and order_logs; once per process. */
export function ensureOrdersSchema(): Promise<void> {
  if (globalThis.__linkoOrdersSchema?.version !== SCHEMA_VERSION) {
    const ready = withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(72120931)")
      await tx.exec(DDL)
    }).catch((error) => {
      globalThis.__linkoOrdersSchema = undefined
      throw error
    })
    globalThis.__linkoOrdersSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoOrdersSchema!.ready
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type OrderRow = {
  id: number
  client: string
  client_id: number | null
  zone: string
  type: string
  product: string
  created: string
  delivery: string
  agent: string
  amount: string
  balance: string
  negative: number
  status: string
  discount: string | null
  payment_date: string | null
  payment_type: string | null
  organization: string | null
  warehouse: string | null
  delivery_man: string | null
  shipped_at: string | null
  currency: string | null
  price_list: string | null
  created_by: string | null
  comment: string | null
  delivery_type: string | null
  deal_type: string | null
  invoice_number: string | null
  invoice_date: string | null
  invoice_active: number | null
  contract: string | null
  created_at: string | null
  c_branch?: string | null
  c_phone?: string | null
  c_deliverer?: string | null
  market_name: string | null
  expeditor: string | null
  accepted_date: string | null
  total_price: number | null
  return_price: number | null
  fact_price: number | null
  weight: number | null
  discount_percent: number | null
  pay_method: string | null
  order_balance: number | null
  transport_number: string | null
  branch_name: string | null
  stock_name: string | null
  paid_amount: number | null
  operative_debt: number | null
  actual_debt: number | null
  pay_type_name: string | null
  due_date: string | null
  wrong_debt: number | null
  invoice_contract: string | null
  operative_expand: string | null
  actual_expand: string | null
}

function parseExpand(raw: string | null): { currency: string; amount: number }[] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as { currency: string; amount: number }[]
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export type ItemRow = {
  id: number
  order_id: number
  product_id: number | null
  product_name: string
  unit: string
  quantity: number
  unit_price: number
  cost_price: number
  discount_percent: number
  currency: string
}

const ORDER_SELECT = `SELECT o.*, c.branch AS c_branch, c.phone AS c_phone, c.deliverer AS c_deliverer
  FROM orders o LEFT JOIN clients c ON c.id = o.client_id`

function rowToOrder(row: OrderRow): Order {
  return {
    id: row.id,
    client: row.client,
    clientId: row.client_id ?? null,
    zone: row.zone,
    type: row.type,
    product: row.product,
    created: row.created,
    delivery: row.delivery,
    agent: row.agent,
    amount: row.amount,
    balance: "",
    negative: false,
    status: row.status,
    discount: row.discount ?? undefined,
    paymentDate: row.payment_date ?? "",
    paymentType: row.payment_type ?? "",
    organization: row.organization ?? "",
    warehouse: row.warehouse ?? "",
    currency: orderCurrencyOf(row) ?? "",
    deliveryMan: row.delivery_man ?? "",
    priceList: row.price_list ?? "",
    createdBy: row.created_by ?? "",
    comment: row.comment ?? "",
    deliveryType: row.delivery_type ?? "",
    dealType: row.deal_type ?? "",
    invoiceNumber: row.invoice_number ?? "",
    invoiceDate: row.invoice_date ?? "",
    invoiceActive: row.invoice_active === 1,
    contract: row.contract ?? "",
    shippedAt: row.shipped_at || null,
    createdAt: row.created_at ?? undefined,
    clientBranch: row.c_branch ?? "",
    clientPhone: row.c_phone ?? "",
    clientDeliverer: row.c_deliverer ?? "",
    marketName: row.market_name ?? "",
    expeditor: row.expeditor ?? "",
    acceptedDate: row.accepted_date ?? "",
    totalPrice: row.total_price ?? undefined,
    returnPrice: Number(row.return_price ?? 0),
    factPrice: row.fact_price ?? undefined,
    weight: Number(row.weight ?? 0),
    discountPercent: Number(row.discount_percent ?? 0),
    payMethod: row.pay_method ?? "",
    orderBalance: row.order_balance ?? undefined,
    transportNumber: row.transport_number ?? "",
    branchName: row.branch_name ?? "",
    stockName: row.stock_name ?? "",
    paidAmount: row.paid_amount ?? undefined,
    operativeDebt: row.operative_debt ?? undefined,
    actualDebt: row.actual_debt ?? undefined,
    payTypeName: row.pay_type_name ?? "",
    dueDate: row.due_date ?? "",
    wrongDebt: row.wrong_debt === 1,
    invoiceContract: row.invoice_contract ?? "",
    operativeExpand: parseExpand(row.operative_expand),
    actualExpand: parseExpand(row.actual_expand),
  }
}

/** The order's currency: the stored one, else the one of its amount text (legacy rows). */
function orderCurrencyOf(row: Pick<OrderRow, "currency" | "amount">): string | null {
  if (row.currency) return row.currency
  return parseMoneyText(row.amount ?? "")?.currency ?? null
}

// ---------------------------------------------------------------------------
// Money text
// ---------------------------------------------------------------------------

/** "60 000 SUM", "1 234,5 USD", "100", "0.45 usd" → value + currency (null when absent). */
export function parseMoneyText(text: string): { value: number; currency: string | null } | null {
  const match = /^\s*(-?[\d\s  .,]*\d)\s*([A-Za-z]{2,10})?\s*$/.exec(String(text ?? ""))
  if (!match) return null
  const digits = match[1].replace(/[\s  ]/g, "").replace(",", ".")
  if (!/^-?\d+(\.\d+)?$/.test(digits)) return null
  const value = Number(digits)
  if (!Number.isFinite(value)) return null
  return { value, currency: match[2] ? match[2].toUpperCase() : null }
}

export function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100
  const grouped = rounded.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ")
  return `${grouped} ${currency}`
}

/** Keeps the reference totals (total / fact price, order balance) that the card and debt pages read in step with the order's amount. */
async function syncOrderTotals(db: PgDb, id: number, amount: string): Promise<void> {
  const total = parseMoneyText(amount)?.value ?? 0
  await db
    .prepare(
      `UPDATE orders SET total_price = @total, fact_price = @total - COALESCE(return_price, 0),
       order_balance = @total - COALESCE(return_price, 0) - COALESCE(paid_amount, 0) WHERE id = @id`,
    )
    .run({ id, total })
}

function roundQty(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

export function lineTotal(row: Pick<ItemRow, "quantity" | "unit_price" | "discount_percent">): number {
  return Number(row.quantity) * Number(row.unit_price) * (1 - Number(row.discount_percent) / 100)
}

// ---------------------------------------------------------------------------
// Lookups (validated references)
// ---------------------------------------------------------------------------

export type ClientRef = { id: number; name: string; zone: string; type: string; agent: string; deliverer: string }

const NOT_SET = new Set(["", "не указано", "не указан", "—", "-"])

/** By id, else by exact name (case / spacing-insensitive). 400 when missing or ambiguous. */
export async function resolveClient(db: PgDb, input: { clientId?: number | null; client?: string | null }): Promise<ClientRef> {
  if (input.clientId !== undefined && input.clientId !== null) {
    const row = (await db.prepare("SELECT id, name, zone, type, agent, deliverer FROM clients WHERE id = ?").get(input.clientId)) as ClientRef | undefined
    if (!row) throw new OrderError("Клиент не найден", 400, { field: "clientId" })
    return row
  }
  const name = String(input.client ?? "").trim()
  if (!name) throw new OrderError("Укажите клиента", 400, { field: "client" })
  const rows = (await db
    .prepare(`SELECT id, name, zone, type, agent, deliverer FROM clients WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY id LIMIT 2`)
    .all({ name })) as ClientRef[]
  if (!rows.length) throw new OrderError("Клиент не найден", 400, { field: "client" })
  if (rows.length > 1) throw new OrderError("Найдено несколько клиентов с таким названием, укажите clientId", 400, { field: "client" })
  return rows[0]
}

/** Canonical warehouse name; 400 when unknown or inactive. */
export async function resolveWarehouse(db: PgDb, name: string): Promise<string> {
  const row = (await db
    .prepare(`SELECT name, active FROM warehouses WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY id LIMIT 1`)
    .get({ name })) as { name: string; active: number | null } | undefined
  if (!row) throw new OrderError(`Склад «${name}» не найден`, 400, { field: "warehouse" })
  if (row.active === 0) throw new OrderError(`Склад «${row.name}» неактивен`, 400, { field: "warehouse" })
  return row.name
}

/** Canonical "First Last" of an employee; "" for "Не указано". 400 when unknown. */
export async function resolveEmployee(db: PgDb, name: string, field: string, label: string): Promise<string> {
  if (NOT_SET.has(nameKey(name))) return ""
  const row = (await db
    .prepare(
      `SELECT btrim(first_name || ' ' || last_name) AS name FROM employees
        WHERE ${keySql("first_name || ' ' || last_name")} = ${keySql("@name::text")} ORDER BY id LIMIT 1`,
    )
    .get({ name })) as { name: string } | undefined
  if (!row) throw new OrderError(`${label}: сотрудник «${name}» не найден`, 400, { field })
  return row.name
}

async function currencyCodes(db: PgDb): Promise<{ base: string; codes: Map<string, string> }> {
  const rows = (await db.prepare("SELECT code, is_base FROM currencies ORDER BY is_base DESC, id").all()) as Array<{ code: string; is_base: number }>
  const codes = new Map(rows.map((row) => [row.code.trim().toUpperCase(), row.code.trim()]))
  const base = rows.find((row) => row.is_base === 1)?.code.trim() || rows[0]?.code.trim() || "SUM"
  if (!codes.size) codes.set(base.toUpperCase(), base)
  return { base, codes }
}

export async function resolveCurrency(db: PgDb, code: string): Promise<string> {
  const { codes } = await currencyCodes(db)
  const found = codes.get(code.trim().toUpperCase())
  if (!found) throw new OrderError(`Неизвестная валюта «${code}»`, 400, { field: "currency" })
  return found
}

export async function baseCurrency(db: PgDb): Promise<string> {
  return (await currencyCodes(db)).base
}

export type ProductRef = { id: number; name: string; unit: string }

/** A sellable catalog product by id, else by exact name. 400 when unknown, deleted or not for sale. */
export async function resolveProduct(db: PgDb, input: { productId?: number | null; productName?: string | null }): Promise<ProductRef> {
  let row: { id: number; name: string; unit: string; can_sell: number; deleted: number } | undefined
  if (input.productId !== undefined && input.productId !== null) {
    row = (await db.prepare("SELECT id, name, unit, can_sell, deleted FROM products WHERE id = ?").get(input.productId)) as typeof row
    if (!row) throw new OrderError("Товар не найден в каталоге", 400, { field: "productId" })
  } else {
    const name = String(input.productName ?? "").trim()
    if (!name) throw new OrderError("Укажите товар", 400, { field: "productId" })
    const rows = (await db
      .prepare(`SELECT id, name, unit, can_sell, deleted FROM products WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY deleted, id LIMIT 2`)
      .all({ name })) as NonNullable<typeof row>[]
    if (!rows.length) throw new OrderError(`Товар «${name}» не найден в каталоге`, 400, { field: "productName" })
    row = rows[0]
  }
  if (row.deleted === 1) throw new OrderError(`Товар «${row.name}» удален`, 400, { field: "productId" })
  if (row.can_sell === 0) throw new OrderError(`Товар «${row.name}» недоступен для продажи`, 400, { field: "productId" })
  return { id: row.id, name: row.name, unit: row.unit || "шт." }
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export type OrderLineInput = {
  productId?: number
  productName?: string
  unit?: string
  quantity: number
  unitPrice: number
  costPrice?: number
  discountPercent?: number
  currency?: string
}

type ResolvedLine = {
  productId: number
  productName: string
  unit: string
  quantity: number
  unitPrice: number
  costPrice: number
  discountPercent: number
}

async function resolveLine(db: PgDb, line: OrderLineInput, orderCurrency: string): Promise<ResolvedLine> {
  const product = await resolveProduct(db, { productId: line.productId, productName: line.productName })
  if (line.currency !== undefined && line.currency.trim() && line.currency.trim().toUpperCase() !== orderCurrency.toUpperCase()) {
    throw new OrderError(`Валюта позиции (${line.currency.trim().toUpperCase()}) не совпадает с валютой заказа (${orderCurrency})`, 400, { field: "currency" })
  }
  const quantity = Number(line.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QTY) throw new OrderError("Количество должно быть больше 0 и не больше 1 000 000 000", 400, { field: "quantity" })
  const unitPrice = Number(line.unitPrice)
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > MAX_MONEY) throw new OrderError("Цена должна быть от 0 до 10 000 000 000 000", 400, { field: "unitPrice" })
  const discountPercent = Number(line.discountPercent ?? 0)
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new OrderError("Скидка должна быть от 0 до 100%", 400, { field: "discountPercent" })
  const costPrice = Number(line.costPrice ?? 0)
  if (!Number.isFinite(costPrice) || costPrice < 0 || costPrice > MAX_MONEY) throw new OrderError("Неверная себестоимость", 400, { field: "costPrice" })
  if (quantity * unitPrice > MAX_MONEY) throw new OrderError("Сумма позиции слишком большая", 400, { field: "unitPrice" })
  return {
    productId: product.id,
    productName: product.name,
    unit: (line.unit ?? "").trim() || product.unit,
    quantity,
    unitPrice,
    costPrice,
    discountPercent,
  }
}

async function listItemRows(db: PgDb, orderId: number): Promise<ItemRow[]> {
  return (await db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC").all(orderId)) as ItemRow[]
}

/** orders.amount / product from the lines; no lines → "0 <currency>" / "—" (or the kept free amount). */
async function syncSummary(db: PgDb, order: OrderRow, keepAmount?: string): Promise<void> {
  const items = await listItemRows(db, order.id)
  const currency = orderCurrencyOf(order) ?? (await baseCurrency(db))
  let amount: string
  let product: string
  if (!items.length) {
    amount = keepAmount ?? formatMoney(0, currency)
    product = keepAmount !== undefined ? order.product || "—" : "—"
  } else {
    const total = items.reduce((sum, item) => sum + lineTotal(item), 0)
    amount = formatMoney(total, currency)
    product = items.map((item) => `${item.product_name} x${roundQty(Number(item.quantity))}`).join(", ")
  }
  await db.prepare("UPDATE orders SET amount = @amount, product = @product, updated_at = datetime('now') WHERE id = @id").run({ id: order.id, amount, product })
  await syncOrderTotals(db, order.id, amount)
}

// ---------------------------------------------------------------------------
// Stock availability (contract 4)
// ---------------------------------------------------------------------------

const LEDGER_END = "2100-12-31"

type Need = { key: string; name: string; quantity: number }

function lineKey(productId: number | null, name: string): string {
  return productId ? `product:${productId}` : `name:${nameKey(name)}`
}

/** 409 when on hand − reserved by other orders cannot cover `needs` at `warehouse`.
 * `ownReserved` = quantities this order already reserves there (excluded). Reads
 * committed data on a separate connection (callers hold the order lock). */
async function assertAvailable(warehouse: string, needs: Need[], ownReserved: Map<string, number>): Promise<void> {
  const wanted = new Map<string, Need>()
  for (const need of needs) {
    const current = wanted.get(need.key)
    if (current) current.quantity += need.quantity
    else wanted.set(need.key, { ...need })
  }
  if (!wanted.size) return
  const [balances, pending] = await Promise.all([
    getStockBalances({ warehouses: [warehouse], date: LEDGER_END }),
    getStockPending({ warehouses: [warehouse] }),
  ])
  const onHand = new Map<string, number>()
  for (const row of balances) if (nameKey(row.warehouse) === nameKey(warehouse)) onHand.set(row.key, (onHand.get(row.key) ?? 0) + row.qty)
  const reserved = new Map<string, number>()
  for (const row of pending) if (nameKey(row.warehouse) === nameKey(warehouse)) reserved.set(row.key, (reserved.get(row.key) ?? 0) + row.reserved)
  const short: Array<{ product: string; needed: number; available: number }> = []
  for (const need of wanted.values()) {
    const available = roundQty((onHand.get(need.key) ?? 0) - ((reserved.get(need.key) ?? 0) - (ownReserved.get(need.key) ?? 0)))
    if (need.quantity > available + 1e-9) short.push({ product: need.name, needed: roundQty(need.quantity), available: Math.max(0, available) })
  }
  if (short.length) {
    const first = short[0]
    throw new OrderError(
      `Недостаточно товара на складе «${warehouse}»: ${first.product} — нужно ${first.needed}, доступно ${first.available}`,
      409,
      { shortage: short, warehouse },
    )
  }
}

function needsOf(items: Array<Pick<ItemRow, "product_id" | "product_name" | "quantity">>): Need[] {
  return items.map((item) => ({ key: lineKey(item.product_id, item.product_name), name: item.product_name, quantity: Number(item.quantity) }))
}

function reservedBy(order: Pick<OrderRow, "status" | "warehouse">, items: ItemRow[], warehouse: string): Map<string, number> {
  const own = new Map<string, number>()
  if (order.status !== "Есть на складе" || nameKey(order.warehouse ?? "") !== nameKey(warehouse)) return own
  for (const need of needsOf(items)) own.set(need.key, (own.get(need.key) ?? 0) + need.quantity)
  return own
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export type OrderLogEntry = { id: number; kind: string; status: string; comment: string; amount: string; createdBy: string; createdAt: string }

async function addLog(db: PgDb, orderId: number, entry: { kind: "Создан" | "Обновленный"; status: string; comment?: string; amount: string; user: string }) {
  await db
    .prepare("INSERT INTO order_logs (order_id, kind, status, comment, amount, created_by) VALUES (@orderId, @kind, @status, @comment, @amount, @user)")
    .run({ orderId, kind: entry.kind, status: entry.status, comment: entry.comment ?? "", amount: entry.amount, user: entry.user })
}

export async function listOrderLogs(orderId: number): Promise<OrderLogEntry[]> {
  await ensureOrdersSchema()
  const rows = (await getDb().prepare("SELECT * FROM order_logs WHERE order_id = ? ORDER BY id DESC").all(orderId)) as Array<{
    id: number
    kind: string
    status: string
    comment: string
    amount: string
    created_by: string
    created_at: string
  }>
  return rows.map((row) => ({ id: row.id, kind: row.kind, status: row.status, comment: row.comment, amount: row.amount, createdBy: row.created_by, createdAt: row.created_at }))
}

// ---------------------------------------------------------------------------
// Client balances (read-only, from the finance ledger)
// ---------------------------------------------------------------------------

export type ClientLedgerBalance = { lines: string[]; negative: boolean; byCurrency: Record<string, number>; lastOrder: string | null; lastPayment: string | null }

/** Current (today's end) ledger balances per client id; empty map when the ledger is unavailable. */
export async function clientLedgerBalances(options: { keys?: string[]; mode?: "created" | "realization" } = {}): Promise<Map<number, ClientLedgerBalance>> {
  const out = new Map<number, ClientLedgerBalance>()
  try {
    const today = todayIso()
    const result = await getBalanceList("client", { from: today, to: today, pageSize: 0, keys: options.keys, mode: options.mode ?? "created" })
    for (const row of result.rows) {
      if (row.id === null) continue
      const byCurrency: Record<string, number> = {}
      const lines: string[] = []
      for (const currency of result.currencies) {
        const value = Math.round((row.currencies[currency.code]?.end_balance ?? 0) * 100) / 100
        if (Math.abs(value) < 0.005) continue
        byCurrency[currency.code] = value
        lines.push(formatMoney(value, currency.code))
      }
      out.set(row.id, {
        lines,
        negative: Object.values(byCurrency).some((value) => value < 0),
        byCurrency,
        lastOrder: typeof row.info.last_order === "string" ? row.info.last_order : null,
        lastPayment: typeof row.info.last_payment === "string" ? row.info.last_payment : null,
      })
    }
    if (!out.size && !options.keys) return out
    for (const id of out.keys()) if (!out.get(id)!.lines.length) out.get(id)!.lines.push(formatMoney(0, result.baseCurrency))
  } catch (error) {
    console.error("client ledger balances unavailable", error)
  }
  return out
}

async function attachBalances(orders: Order[]): Promise<Order[]> {
  if (!orders.length) return orders
  const ids = [...new Set(orders.map((order) => order.clientId).filter((id): id is number => typeof id === "number"))]
  const balances = await clientLedgerBalances(ids.length <= 50 ? { keys: ids.map(String) } : {})
  for (const order of orders) {
    const balance = order.clientId ? balances.get(order.clientId) : undefined
    order.balance = balance?.lines.join(", ") || ""
    order.negative = balance?.negative ?? false
  }
  return orders
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type OrderInput = Omit<Order, "id">
export type OrderPatch = Partial<OrderInput>

export async function listOrders(search?: string, options: { withBalances?: boolean } = {}): Promise<Order[]> {
  await ensureOrdersSchema()
  const db = getDb()
  const branch = await selectedBranchName()
  const rows = search
    ? ((await db
        .prepare(`${ORDER_SELECT} WHERE (o.client ILIKE @q OR o.agent ILIKE @q OR o.id::text = @id) AND (@branch::text = '' OR o.branch_name = @branch) ORDER BY o.id DESC`)
        .all({ q: `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`, id: search.trim(), branch })) as OrderRow[])
    : ((await db.prepare(`${ORDER_SELECT} WHERE (@branch::text = '' OR o.branch_name = @branch) ORDER BY o.id DESC`).all({ branch })) as OrderRow[])
  const orders = await withLocalPayments(rows.map(rowToOrder))
  return options.withBalances === false ? orders : attachBalances(orders)
}

export async function getOrder(id: number, options: { withBalances?: boolean } = {}): Promise<Order | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await ensureOrdersSchema()
  const row = (await getDb().prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id)) as OrderRow | undefined
  if (!row) return null
  const order = await withLiveDebt((await withLocalPayments([rowToOrder(row)]))[0])
  return options.withBalances === false ? order : (await attachBalances([order]))[0]
}

/** Orders made in the app carry no debt snapshot: show the client's live balance (reference balance + app movements). */
async function withLiveDebt(order: Order): Promise<Order> {
  if (order.operativeExpand?.length || order.operativeDebt || order.actualDebt) return order
  try {
    const lines = await liveClientDebtLines(order.client)
    if (!lines) return order
    return { ...order, operativeExpand: lines, actualExpand: lines, operativeDebt: lines[0]?.amount, actualDebt: lines[0]?.amount }
  } catch {
    return order
  }
}

/**
 * Payments taken in the app (the order card's payments and the group payment) live in customer_payments, not in the
 * reference snapshot kept in orders.paid_amount: add the ones in the order's own currency to "Оплачено" and take them off "Остаток".
 */
async function withLocalPayments(orders: Order[]): Promise<Order[]> {
  if (!orders.length) return orders
  let sums: { order_id: number; currency: string; total: number }[] = []
  try {
    sums = (await getDb()
      .prepare("SELECT order_id, currency, SUM(amount) AS total FROM customer_payments WHERE order_id IS NOT NULL AND COALESCE(is_deleted, 0) = 0 GROUP BY order_id, currency")
      .all()) as typeof sums
  } catch {
    return orders
  }
  if (!sums.length) return orders
  const byOrder = new Map(sums.map((row) => [`${row.order_id}:${row.currency}`, Number(row.total)]))
  return orders.map((order) => {
    const currency = order.amount.trim().split(/\s+/).pop() || "SUM"
    const extra = byOrder.get(`${order.id}:${currency}`)
    if (!extra) return order
    return {
      ...order,
      paidAmount: (order.paidAmount ?? 0) + extra,
      orderBalance: order.orderBalance === undefined ? undefined : Math.max(0, order.orderBalance - extra),
    }
  })
}

/** The client's operative (by creation) and actual (by realization) debt, for the order card. */
export async function getOrderClientDebt(order: Order): Promise<{ operative: string; actual: string; operativeNegative: boolean; actualNegative: boolean } | null> {
  if (!order.clientId) return null
  const key = [String(order.clientId)]
  const [operative, actual] = await Promise.all([clientLedgerBalances({ keys: key, mode: "created" }), clientLedgerBalances({ keys: key, mode: "realization" })])
  const op = operative.get(order.clientId)
  const ac = actual.get(order.clientId)
  return {
    operative: op?.lines.join(", ") ?? "",
    actual: ac?.lines.join(", ") ?? "",
    operativeNegative: op?.negative ?? false,
    actualNegative: ac?.negative ?? false,
  }
}

const RU_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** "20 окт. 14:05" in Asia/Tashkent. */
export function formatOrderTimestamp(date: Date): string {
  const local = new Date(date.getTime() + 5 * 3600 * 1000)
  const day = String(local.getUTCDate()).padStart(2, "0")
  const hours = String(local.getUTCHours()).padStart(2, "0")
  const minutes = String(local.getUTCMinutes()).padStart(2, "0")
  return `${day} ${RU_MONTHS[local.getUTCMonth()]} ${hours}:${minutes}`
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type OrderCreateInput = {
  clientId?: number
  client?: string
  zone?: string
  type?: string
  product?: string
  delivery?: string
  agent?: string
  /** "<amount> [<currency>]" or a number; ignored when `items` are given (the total is derived). */
  amount?: string | number
  currency?: string
  status?: string
  discount?: string
  paymentDate?: string
  paymentType?: "cash" | "bank" | ""
  organization?: string
  warehouse?: string
  deliveryMan?: string
  priceList?: string
  comment?: string
  deliveryType?: string
  dealType?: string
  items?: OrderLineInput[]
}

export type OrderUpdateInput = Omit<OrderCreateInput, "items"> & {
  expeditor?: string
  payMethod?: string
  payTypeName?: string
  stockName?: string
  branchName?: string
  transportNumber?: string
  dueDate?: string
  acceptedDate?: string
  invoiceContract?: string
  /** Snapshot paid / balance of the order (reference data). */
  paidAmount?: number
  orderBalance?: number
  createdAt?: string
  created?: string
  invoiceNumber?: string
  invoiceDate?: string
  invoiceActive?: boolean
  contract?: string
}

function assertStatus(status: string): string {
  if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
    throw new OrderError(`Неизвестный статус «${status}». Допустимо: ${ORDER_STATUSES.join(", ")}`, 400, { field: "status" })
  }
  return status
}

function parseAmount(raw: string | number): { value: number; currency: string | null } {
  const parsed = typeof raw === "number" ? (Number.isFinite(raw) ? { value: raw, currency: null } : null) : parseMoneyText(raw)
  if (!parsed) throw new OrderError("Сумма заказа: укажите число и валюту, например «60000 SUM»", 400, { field: "amount" })
  if (parsed.value < 0) throw new OrderError("Сумма заказа не может быть отрицательной", 400, { field: "amount" })
  if (parsed.value > MAX_MONEY) throw new OrderError("Сумма заказа слишком большая", 400, { field: "amount" })
  return parsed
}

async function lockOrders(db: PgDb) {
  // Serializes order writers, so two orders cannot reserve the same last units.
  await db.exec("SELECT pg_advisory_xact_lock(72120932)")
}

function nowIso(): string {
  return new Date().toISOString()
}

async function prepareWrites() {
  await ensureOrdersSchema()
  // The stock / finance cores install their SQL helpers and extension columns
  // (DDL on orders) on their own connections; do it before our transaction
  // holds a lock on an orders row, or that DDL would wait for us while we
  // wait for the stock check.
  await ensureStockSchema()
  await ensureFinanceSchema()
}

export async function createOrder(input: OrderCreateInput, user: { displayName: string }): Promise<Order> {
  await prepareWrites()
  const id = await withTransaction(async (tx) => {
    await lockOrders(tx)
    const client = await resolveClient(tx, input)
    const status = assertStatus(input.status?.trim() || "Есть на складе")
    let currency = input.currency?.trim() ? await resolveCurrency(tx, input.currency) : null
    const lines = input.items ?? []
    let amountValue = 0
    if (input.amount !== undefined && input.amount !== "") {
      // With lines the total is derived from them; the amount only names the currency.
      const parsed = parseAmount(input.amount)
      if (parsed.currency) {
        const code = await resolveCurrency(tx, parsed.currency)
        if (currency && code !== currency) throw new OrderError("Валюта суммы не совпадает с валютой заказа", 400, { field: "amount" })
        currency = code
      }
      amountValue = parsed.value
    }
    const lineCurrency = lines.find((line) => line.currency?.trim())?.currency
    if (!currency && lineCurrency) currency = await resolveCurrency(tx, lineCurrency)
    currency ??= await baseCurrency(tx)
    const warehouse = input.warehouse?.trim() ? await resolveWarehouse(tx, input.warehouse) : ""
    const agentDefault = !NOT_SET.has(nameKey(client.agent ?? "")) ? client.agent : user.displayName
    const agent = input.agent?.trim() ? (await resolveEmployee(tx, input.agent, "agent", "Агент")) || agentDefault : agentDefault
    const deliveryMan = input.deliveryMan?.trim() ? await resolveEmployee(tx, input.deliveryMan, "deliveryMan", "Доставщик") : ""
    const resolved: ResolvedLine[] = []
    for (const line of lines) resolved.push(await resolveLine(tx, line, currency))
    if (resolved.length && STOCK_STATUSES.includes(status)) {
      if (!warehouse) throw new OrderError("Укажите склад заказа", 400, { field: "warehouse" })
      await assertAvailable(warehouse, resolved.map((line) => ({ key: lineKey(line.productId, line.productName), name: line.productName, quantity: line.quantity })), new Map())
    }
    const total = resolved.reduce((sum, line) => sum + line.quantity * line.unitPrice * (1 - line.discountPercent / 100), 0)
    if (total > MAX_MONEY) throw new OrderError("Сумма заказа слишком большая", 400, { field: "items" })
    const amount = formatMoney(resolved.length ? total : amountValue, currency)
    const product = resolved.length
      ? resolved.map((line) => `${line.productName} x${roundQty(line.quantity)}`).join(", ")
      : input.product?.trim() || "—"
    const inserted = await tx
      .prepare(
        `INSERT INTO orders (client, client_id, zone, type, product, created, delivery, agent, amount, balance, negative, status, discount,
           payment_date, payment_type, organization, warehouse, delivery_man, shipped_at, currency, price_list, created_by, comment,
           delivery_type, deal_type)
         VALUES (@client, @clientId, @zone, @type, @product, @created, @delivery, @agent, @amount, '', 0, @status, @discount,
           @paymentDate, @paymentType, @organization, @warehouse, @deliveryMan, @shippedAt, @currency, @priceList, @createdBy, @comment,
           @deliveryType, @dealType)`,
      )
      .run({
        client: client.name,
        clientId: client.id,
        zone: input.zone?.trim() || client.zone || "",
        type: input.type?.trim() || client.type || "",
        product,
        created: formatOrderTimestamp(new Date()),
        delivery: input.delivery?.trim() || "—",
        agent,
        amount,
        status,
        discount: input.discount?.trim() || null,
        paymentDate: input.paymentDate ?? "",
        paymentType: input.paymentType ?? "",
        organization: input.organization?.trim() ?? "",
        warehouse,
        deliveryMan,
        shippedAt: RELEASED_STATUSES.includes(status) ? nowIso() : null,
        currency,
        priceList: input.priceList?.trim() ?? "",
        createdBy: user.displayName,
        comment: input.comment?.trim() ?? "",
        deliveryType: input.deliveryType?.trim() ?? "",
        dealType: input.dealType?.trim() ?? "",
      })
    const orderId = Number(inserted.lastInsertRowid)
    await syncOrderTotals(tx, orderId, amount)
    await tx
      .prepare("UPDATE orders SET market_name = client, pay_method = 'cash', branch_name = COALESCE(NULLIF(@branch, ''), branch_name) WHERE id = @id")
      .run({ id: orderId, branch: await selectedBranchName() })
    for (const line of resolved) await insertLine(tx, orderId, line, currency)
    await addLog(tx, orderId, { kind: "Создан", status, amount, user: user.displayName })
    return orderId
  })
  return (await getOrder(id))!
}

async function insertLine(db: PgDb, orderId: number, line: ResolvedLine, currency: string): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit, quantity, unit_price, cost_price, discount_percent, currency)
       VALUES (@orderId, @productId, @productName, @unit, @quantity, @unitPrice, @costPrice, @discountPercent, @currency)`,
    )
    .run({ orderId, ...line, currency })
  return Number(result.lastInsertRowid)
}

/** Fields that may still change once the order is final (Доставлено / Отменен). */
const FINAL_EDITABLE = new Set(["paymentDate", "comment", "invoiceNumber", "invoiceDate", "invoiceActive", "contract", "invoiceContract", "dueDate", "paidAmount", "orderBalance", "acceptedDate", "transportNumber", "expeditor", "payMethod", "payTypeName"])
/** Fields fixed once the goods left the warehouse (В пути). */
const SHIPPED_FIXED = new Set(["clientId", "client", "amount", "currency", "warehouse"])
/** API field → orders column (text fields compared against the stored value). */
const FIELD_COLUMNS: Record<string, string> = {
  client: "client",
  zone: "zone",
  type: "type",
  product: "product",
  delivery: "delivery",
  agent: "agent",
  amount: "amount",
  currency: "currency",
  discount: "discount",
  paymentType: "payment_type",
  organization: "organization",
  warehouse: "warehouse",
  deliveryMan: "delivery_man",
  priceList: "price_list",
  deliveryType: "delivery_type",
  dealType: "deal_type",
  created: "created",
}

export async function updateOrder(id: number, patch: OrderUpdateInput, user: { displayName: string }): Promise<Order | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await prepareWrites()
  const found = await withTransaction(async (tx) => {
    await lockOrders(tx)
    const current = (await tx.prepare("SELECT * FROM orders WHERE id = ? FOR UPDATE").get(id)) as OrderRow | undefined
    if (!current) return false
    const items = await listItemRows(tx, id)
    const from = current.status
    const target = patch.status !== undefined ? assertStatus(patch.status.trim()) : from
    const changed = Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => key)

    if (target !== from && !canChangeStatus(from, target)) {
      throw new OrderError(`Нельзя изменить статус заказа с «${from}» на «${target}»`, 409, { from, to: target })
    }
    if (FINAL_STATUSES.includes(from)) {
      // Only the payment terms / invoice details of a final order may still change.
      const blocked = changed.filter((key) => key !== "status" && !FINAL_EDITABLE.has(key))
      const reallyChanged = blocked.filter((key) => {
        const value = (patch as Record<string, unknown>)[key]
        const column = FIELD_COLUMNS[key]
        if (!column || typeof value !== "string") return true
        const stored = String((current as Record<string, unknown>)[column] ?? "")
        return key === "client" || key === "agent" || key === "deliveryMan" || key === "warehouse" ? nameKey(value) !== nameKey(stored) : value.trim() !== stored
      })
      if (reallyChanged.length) throw new OrderError(`Заказ в статусе «${from}» нельзя изменить`, 409, { fields: reallyChanged })
    }

    const next: Record<string, unknown> = {}
    let currency = orderCurrencyOf(current) ?? (await baseCurrency(tx))
    const sets = (column: string, value: unknown) => {
      next[column] = value
    }

    // Client
    if (patch.clientId !== undefined || (patch.client !== undefined && nameKey(patch.client) !== nameKey(current.client))) {
      const client = await resolveClient(tx, { clientId: patch.clientId, client: patch.client })
      if (client.id !== current.client_id || client.name !== current.client) {
        sets("client", client.name)
        sets("client_id", client.id)
        if (patch.zone === undefined) sets("zone", client.zone || "")
        if (patch.type === undefined) sets("type", client.type || "")
      }
    }
    // Currency / amount
    if (patch.currency !== undefined && patch.currency.trim()) {
      const code = await resolveCurrency(tx, patch.currency)
      if (code !== currency) {
        if (items.length) throw new OrderError("Валюту заказа с товарами изменить нельзя", 409, { field: "currency" })
        currency = code
        sets("currency", code)
      }
    }
    if (patch.amount !== undefined && patch.amount !== "") {
      const parsed = parseAmount(patch.amount)
      const code = parsed.currency ? await resolveCurrency(tx, parsed.currency) : currency
      const text = formatMoney(parsed.value, code)
      const currentParsed = parseMoneyText(current.amount)
      const same = currentParsed && Math.abs(currentParsed.value - parsed.value) < 0.005 && (currentParsed.currency ?? currency) === code
      if (!same) {
        if (items.length) throw new OrderError("Сумма заказа рассчитывается по товарам", 409, { field: "amount" })
        if (code !== currency) {
          currency = code
          sets("currency", code)
        }
        sets("amount", text)
      }
    }
    // Warehouse
    let warehouse = current.warehouse ?? ""
    if (patch.warehouse !== undefined && nameKey(patch.warehouse) !== nameKey(warehouse)) {
      warehouse = patch.warehouse.trim() ? await resolveWarehouse(tx, patch.warehouse) : ""
      sets("warehouse", warehouse)
    }
    if (from === "В пути" || from === "Доставлено") {
      const blocked = Object.keys(next).filter((column) => SHIPPED_FIXED.has(column === "client_id" ? "clientId" : column))
      if (blocked.length) throw new OrderError("Клиента, сумму, валюту и склад отгруженного заказа изменить нельзя", 409, { fields: blocked })
    }
    // People
    if (patch.agent !== undefined && nameKey(patch.agent) !== nameKey(current.agent)) {
      sets("agent", (await resolveEmployee(tx, patch.agent, "agent", "Агент")) || current.agent)
    }
    if (patch.deliveryMan !== undefined && nameKey(patch.deliveryMan) !== nameKey(current.delivery_man ?? "")) {
      sets("delivery_man", await resolveEmployee(tx, patch.deliveryMan, "deliveryMan", "Доставщик"))
    }
    // Plain fields
    const text = (value: string | undefined) => (value === undefined ? undefined : value.trim())
    const plain: Array<[keyof OrderUpdateInput, string]> = [
      ["zone", "zone"],
      ["type", "type"],
      ["delivery", "delivery"],
      ["discount", "discount"],
      ["paymentDate", "payment_date"],
      ["paymentType", "payment_type"],
      ["organization", "organization"],
      ["priceList", "price_list"],
      ["comment", "comment"],
      ["deliveryType", "delivery_type"],
      ["dealType", "deal_type"],
      ["created", "created"],
      ["invoiceNumber", "invoice_number"],
      ["invoiceDate", "invoice_date"],
      ["contract", "contract"],
      ["expeditor", "expeditor"],
      ["payMethod", "pay_method"],
      ["payTypeName", "pay_type_name"],
      ["stockName", "stock_name"],
      ["branchName", "branch_name"],
      ["transportNumber", "transport_number"],
      ["dueDate", "due_date"],
      ["acceptedDate", "accepted_date"],
      ["invoiceContract", "invoice_contract"],
      ["createdAt", "created_at"],
    ]
    for (const [field, column] of plain) {
      const value = text(patch[field] as string | undefined)
      if (value !== undefined && value !== ((current as Record<string, unknown>)[column] ?? "")) sets(column, value)
    }
    if (patch.product !== undefined && !items.length && patch.product.trim() !== current.product) sets("product", patch.product.trim() || "—")
    for (const [field, column] of [["paidAmount", "paid_amount"], ["orderBalance", "order_balance"]] as const) {
      const value = patch[field]
      if (value !== undefined && value !== (current as Record<string, unknown>)[column]) sets(column, value)
    }
    // A new amount (items added / edited) moves the totals with it: the card, the debt pages and the balances read these columns.
    if ("amount" in next && patch.orderBalance === undefined) {
      const total = parseMoneyText(String(next.amount))?.value ?? 0
      sets("total_price", total)
      sets("fact_price", total - Number(current.return_price ?? 0))
      sets("order_balance", total - Number(current.return_price ?? 0) - Number(patch.paidAmount ?? current.paid_amount ?? 0))
    }
    if (patch.invoiceActive !== undefined && (patch.invoiceActive ? 1 : 0) !== (current.invoice_active ?? 0)) sets("invoice_active", patch.invoiceActive ? 1 : 0)

    // Status and stock
    if (target !== from) sets("status", target)
    if (items.length && STOCK_STATUSES.includes(target)) {
      if (!warehouse) throw new OrderError("Укажите склад заказа", 400, { field: "warehouse" })
      const entering = !STOCK_STATUSES.includes(from)
      const releasing = from === "Есть на складе" && RELEASED_STATUSES.includes(target)
      const moved = "warehouse" in next
      const unknownFrom = !(ORDER_STATUSES as readonly string[]).includes(from)
      if (entering || releasing || moved || unknownFrom) {
        await assertAvailable(warehouse, needsOf(items), reservedBy(current, items, warehouse))
      }
    }
    if (RELEASED_STATUSES.includes(target) && !RELEASED_STATUSES.includes(from)) sets("shipped_at", nowIso())
    if (!RELEASED_STATUSES.includes(target) && current.shipped_at) sets("shipped_at", null)

    const changedColumns = Object.keys(next)
    const currencyChanged = "currency" in next
    // Legacy rows get their currency stored with the first real change.
    if (changedColumns.length && !current.currency && !currencyChanged) next.currency = currency
    const columns = Object.keys(next)
    if (changedColumns.length) {
      await tx
        .prepare(`UPDATE orders SET ${columns.map((column) => `${column} = @${column}`).join(", ")}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...next, id })
      if (!items.length && currencyChanged && !("amount" in next)) {
        const after = (await tx.prepare("SELECT amount FROM orders WHERE id = ?").get(id)) as { amount: string }
        const value = parseMoneyText(after.amount)?.value ?? 0
        await tx.prepare("UPDATE orders SET amount = @amount WHERE id = @id").run({ id, amount: formatMoney(value, currency) })
        await syncOrderTotals(tx, id, formatMoney(value, currency))
      }
      const comment =
        target !== from
          ? `Изменен статус: ${from} - ${target}`
          : `Изменено: ${changedColumns.join(", ")}`
      const amountRow = (await tx.prepare("SELECT amount FROM orders WHERE id = ?").get(id)) as { amount: string }
      await addLog(tx, id, { kind: "Обновленный", status: target, comment, amount: amountRow.amount, user: user.displayName })
    }
    return true
  })
  return found ? getOrder(id) : null
}

export async function deleteOrder(id: number): Promise<boolean> {
  const result = await getDb().prepare("DELETE FROM orders WHERE id = ?").run(id)
  return result.changes > 0
}

// ---------------------------------------------------------------------------
// Line writes (used by lib/order-items-repo.ts)
// ---------------------------------------------------------------------------

type LineOp = { kind: "create"; line: OrderLineInput } | { kind: "update"; itemId: number; line: OrderLineInput } | { kind: "delete"; itemId: number }

/** Adds / changes / removes one line of an order: the order must exist (404)
 * and be editable (409); the line is validated against the catalog; a
 * reserved order re-checks stock; the order total follows. Returns the line
 * id, or null when the line does not exist. */
export async function writeOrderLine(orderId: number, op: LineOp, user: { displayName: string }): Promise<number | null> {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || orderId > 2_147_483_647) throw new OrderError("Заказ не найден", 404)
  await prepareWrites()
  return withTransaction(async (tx) => {
    await lockOrders(tx)
    const order = (await tx.prepare("SELECT * FROM orders WHERE id = ? FOR UPDATE").get(orderId)) as OrderRow | undefined
    if (!order) throw new OrderError("Заказ не найден", 404)
    const known = (ORDER_STATUSES as readonly string[]).includes(order.status)
    if (known && !EDITABLE_STATUSES.includes(order.status)) {
      throw new OrderError(`Товары заказа в статусе «${order.status}» изменить нельзя`, 409, { status: order.status })
    }
    const items = await listItemRows(tx, orderId)
    const currency = orderCurrencyOf(order) ?? (await baseCurrency(tx))
    let existing: ItemRow | undefined
    if (op.kind !== "create") {
      existing = items.find((item) => item.id === op.itemId)
      if (!existing) return null
    }
    let resolved: ResolvedLine | null = null
    if (op.kind !== "delete") {
      // New lines take the order currency; a legacy line of another currency keeps its own.
      const expected = existing && existing.currency && existing.currency.toUpperCase() !== currency.toUpperCase() ? existing.currency : currency
      resolved = await resolveLine(tx, op.line, expected)
    }
    // Stock of a reserved order: the order's quantities after the change.
    if (resolved && STOCK_STATUSES.includes(order.status)) {
      const warehouse = order.warehouse ?? ""
      if (!warehouse) throw new OrderError("Укажите склад заказа", 400, { field: "warehouse" })
      const key = lineKey(resolved.productId, resolved.productName)
      const after = items
        .filter((item) => !existing || item.id !== existing.id)
        .filter((item) => lineKey(item.product_id, item.product_name) === key)
        .reduce((sum, item) => sum + Number(item.quantity), resolved.quantity)
      await assertAvailable(warehouse, [{ key, name: resolved.productName, quantity: after }], reservedBy(order, items, warehouse))
    }
    let lineId: number | null = existing?.id ?? null
    let comment = ""
    if (op.kind === "create" && resolved) {
      lineId = await insertLine(tx, orderId, resolved, currency)
      comment = `Добавлен товар: ${resolved.productName} x${roundQty(resolved.quantity)}`
    } else if (op.kind === "update" && resolved && existing) {
      await tx
        .prepare(
          `UPDATE order_items SET product_id = @productId, product_name = @productName, unit = @unit, quantity = @quantity,
             unit_price = @unitPrice, cost_price = @costPrice, discount_percent = @discountPercent
           WHERE id = @id AND order_id = @orderId`,
        )
        .run({ ...resolved, id: existing.id, orderId })
      comment = `Изменен товар: ${resolved.productName} x${roundQty(resolved.quantity)}`
    } else if (op.kind === "delete" && existing) {
      await tx.prepare("DELETE FROM order_items WHERE id = ? AND order_id = ?").run(existing.id, orderId)
      comment = `Удален товар: ${existing.product_name}`
    }
    if (!order.currency) await tx.prepare("UPDATE orders SET currency = @currency WHERE id = @id").run({ id: orderId, currency })
    await syncSummary(tx, { ...order, currency })
    const amountRow = (await tx.prepare("SELECT amount FROM orders WHERE id = ?").get(orderId)) as { amount: string }
    await addLog(tx, orderId, { kind: "Обновленный", status: order.status, comment, amount: amountRow.amount, user: user.displayName })
    return lineId
  })
}
