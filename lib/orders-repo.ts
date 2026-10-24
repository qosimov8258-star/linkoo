import { liveClientDebtLines } from "@/lib/client-live-balance"
import { selectedBranchName } from "@/lib/selected-branch"
import "server-only"

import { getDb } from "@/lib/db"
import type { Order } from "@/components/orders/orders-data"

type OrderRow = {
  id: number
  client: string
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
  market_name: string | null
  delivery_man: string | null
  expeditor: string | null
  accepted_date: string | null
  total_price: number | null
  return_price: number | null
  fact_price: number | null
  weight: number | null
  discount_percent: number | null
  pay_method: string | null
  order_balance: number | null
  invoice_active: number | null
  transport_number: string | null
  branch_name: string | null
  stock_name: string | null
  price_list: string | null
  paid_amount: number | null
  operative_debt: number | null
  actual_debt: number | null
  deal_type: string | null
  delivery_type: string | null
  pay_type_name: string | null
  due_date: string | null
  wrong_debt: number | null
  created_at: string | null
  invoice_number: string | null
  invoice_date: string | null
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

function rowToOrder(row: OrderRow): Order {
  return {
    id: row.id,
    client: row.client,
    zone: row.zone,
    type: row.type,
    product: row.product,
    created: row.created,
    delivery: row.delivery,
    agent: row.agent,
    amount: row.amount,
    balance: row.balance,
    negative: row.negative === 1,
    status: row.status,
    discount: row.discount ?? undefined,
    paymentDate: row.payment_date ?? "",
    paymentType: row.payment_type ?? "",
    organization: row.organization ?? "",
    marketName: row.market_name ?? "",
    deliveryMan: row.delivery_man ?? "",
    expeditor: row.expeditor ?? "",
    acceptedDate: row.accepted_date ?? "",
    totalPrice: row.total_price ?? undefined,
    returnPrice: Number(row.return_price ?? 0),
    factPrice: row.fact_price ?? undefined,
    weight: Number(row.weight ?? 0),
    discountPercent: Number(row.discount_percent ?? 0),
    payMethod: row.pay_method ?? "",
    orderBalance: row.order_balance ?? undefined,
    invoiceActive: row.invoice_active === 1,
    transportNumber: row.transport_number ?? "",
    branchName: row.branch_name ?? "",
    stockName: row.stock_name ?? "",
    priceList: row.price_list ?? "",
    paidAmount: row.paid_amount ?? undefined,
    operativeDebt: row.operative_debt ?? undefined,
    actualDebt: row.actual_debt ?? undefined,
    dealType: row.deal_type ?? "",
    deliveryType: row.delivery_type ?? "",
    payTypeName: row.pay_type_name ?? "",
    dueDate: row.due_date ?? "",
    wrongDebt: row.wrong_debt === 1,
    createdAt: row.created_at ?? "",
    invoiceNumber: row.invoice_number ?? "",
    invoiceDate: row.invoice_date ?? "",
    invoiceContract: row.invoice_contract ?? "",
    operativeExpand: parseExpand(row.operative_expand),
    actualExpand: parseExpand(row.actual_expand),
  }
}

// Payment terms read by "Ожидаемые оплаты" (lib/cash/customer-payments.ts adds
// the same columns; whichever module runs first creates them).
let paymentColumnsReady: Promise<void> | undefined

function ensurePaymentColumns(): Promise<void> {
  paymentColumnsReady ??= getDb()
    .exec(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_date TEXT NOT NULL DEFAULT '';
       ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT '';
       ALTER TABLE orders ADD COLUMN IF NOT EXISTS organization TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS market_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_man TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS expeditor TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_price DOUBLE PRECISION;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_price DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS fact_price DOUBLE PRECISION;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS weight DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_percent DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_method TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_balance DOUBLE PRECISION;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_active INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS transport_number TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS branch_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_list TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount DOUBLE PRECISION;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS operative_debt DOUBLE PRECISION;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS actual_debt DOUBLE PRECISION;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS deal_type TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_type_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS due_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS wrong_debt INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_contract TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS operative_expand TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS actual_expand TEXT NOT NULL DEFAULT '';`,
    )
    .catch((error: unknown) => {
      paymentColumnsReady = undefined
      throw error
    })
  return paymentColumnsReady
}

export type OrderInput = Omit<Order, "id">
export type OrderPatch = Partial<OrderInput>

export async function listOrders(search?: string): Promise<Order[]> {
  await ensurePaymentColumns()
  const db = getDb()
  const branch = await selectedBranchName()
  const rows = search
    ? ((await db.prepare("SELECT * FROM orders WHERE (client LIKE ? OR agent LIKE ?) AND (?::text = '' OR branch_name = ?) ORDER BY id DESC").all(
              `%${search}%`,
              `%${search}%`,
              branch,
              branch,
            )) as OrderRow[])
    : ((await db.prepare("SELECT * FROM orders WHERE (?::text = '' OR branch_name = ?) ORDER BY id DESC").all(branch, branch)) as OrderRow[])
  return withLocalPayments(rows.map(rowToOrder))
}

export async function getOrder(id: number): Promise<Order | null> {
  await ensurePaymentColumns()
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM orders WHERE id = ?").get(id)) as OrderRow | undefined
  if (!row) return null
  const order = (await withLocalPayments([rowToOrder(row)]))[0]
  return withLiveDebt(order)
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

const RU_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

export function formatOrderTimestamp(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${day} ${RU_MONTHS[date.getMonth()]} ${hours}:${minutes}`
}

const defaultOrder: OrderInput = {
  client: "Новый клиент",
  zone: "",
  type: "market",
  product: "—",
  created: "",
  delivery: "—",
  agent: "Admin Ritm",
  amount: "0 SUM",
  balance: "0 SUM",
  status: "Есть на складе",
}

/** "1 000,5 SUM" -> 1000.5 (list totals and the payment icon read the numeric columns). */
function amountNumber(amount: string): number {
  const value = Number(amount.replace(/[^\d,.-]/g, "").replace(",", "."))
  return Number.isFinite(value) ? value : 0
}

export async function createOrder(input: Partial<OrderInput>): Promise<Order> {
  await ensurePaymentColumns()
  const db = getDb()
  const cleaned = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<OrderInput>
  const values = { ...defaultOrder, ...cleaned }
  const total = amountNumber(values.amount)
  const result = (await db
      .prepare(
        `INSERT INTO orders (client, zone, type, product, created, delivery, agent, amount, balance, negative, status, discount,
         payment_date, payment_type, organization, market_name, delivery_man, total_price, fact_price, order_balance, pay_method,
         pay_type_name, price_list, stock_name, branch_name, deal_type, delivery_type, due_date, transport_number, expeditor)
       VALUES (@client, @zone, @type, @product, @created, @delivery, @agent, @amount, @balance, @negative, @status, @discount,
         @payment_date, @payment_type, @organization, @client, @delivery_man, @total, @total, @total, @pay_method,
         @pay_type_name, @price_list, @stock_name, @branch_name, @deal_type, @delivery_type, @due_date, @transport_number, @expeditor)`,
      )
      .run({
        client: values.client,
        zone: values.zone,
        type: values.type,
        product: values.product,
        created: values.created,
        delivery: values.delivery,
        agent: values.agent,
        amount: values.amount,
        balance: values.balance,
        negative: values.negative ? 1 : 0,
        status: values.status,
        discount: values.discount ?? null,
        payment_date: values.paymentDate ?? "",
        payment_type: values.paymentType ?? "",
        organization: values.organization ?? "",
        delivery_man: values.deliveryMan || values.agent,
        total,
        pay_method: values.payMethod || "cash",
        pay_type_name: values.payTypeName ?? "",
        price_list: values.priceList ?? "",
        stock_name: values.stockName ?? "",
        branch_name: values.branchName ?? "",
        deal_type: values.dealType || "0",
        delivery_type: values.deliveryType ?? "",
        due_date: values.dueDate ?? "",
        transport_number: values.transportNumber ?? "",
        expeditor: values.expeditor ?? "",
      }))
  return (await getOrder(Number(result.lastInsertRowid)))!
}

export async function updateOrder(id: number, patch: OrderPatch): Promise<Order | null> {
  const existing = (await getOrder(id))
  if (!existing) return null

  const merged: OrderInput = { ...existing, ...patch }
  const db = getDb()
  await db.prepare(
        `UPDATE orders SET client = @client, zone = @zone, type = @type, product = @product, created = @created,
       delivery = @delivery, agent = @agent, amount = @amount, balance = @balance, negative = @negative,
       status = @status, discount = @discount, payment_date = @payment_date, payment_type = @payment_type,
       organization = @organization, delivery_man = @delivery_man, expeditor = @expeditor,
       pay_method = @pay_method, pay_type_name = @pay_type_name, price_list = @price_list, stock_name = @stock_name,
       branch_name = @branch_name, deal_type = @deal_type, delivery_type = @delivery_type, due_date = @due_date,
       transport_number = @transport_number, accepted_date = @accepted_date, paid_amount = @paid_amount,
       order_balance = @order_balance, invoice_active = @invoice_active, invoice_number = @invoice_number,
       invoice_date = @invoice_date, invoice_contract = @invoice_contract, created_at = @created_at, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        client: merged.client,
        zone: merged.zone,
        type: merged.type,
        product: merged.product,
        created: merged.created,
        delivery: merged.delivery,
        agent: merged.agent,
        amount: merged.amount,
        balance: merged.balance,
        negative: merged.negative ? 1 : 0,
        status: merged.status,
        discount: merged.discount ?? null,
        payment_date: merged.paymentDate ?? "",
        payment_type: merged.paymentType ?? "",
        organization: merged.organization ?? "",
        delivery_man: merged.deliveryMan ?? "",
        expeditor: merged.expeditor ?? "",
        pay_method: merged.payMethod ?? "",
        pay_type_name: merged.payTypeName ?? "",
        price_list: merged.priceList ?? "",
        stock_name: merged.stockName ?? "",
        branch_name: merged.branchName ?? "",
        deal_type: merged.dealType ?? "",
        delivery_type: merged.deliveryType ?? "",
        due_date: merged.dueDate ?? "",
        transport_number: merged.transportNumber ?? "",
        accepted_date: merged.acceptedDate ?? "",
        paid_amount: merged.paidAmount ?? null,
        order_balance: merged.orderBalance ?? null,
        invoice_active: merged.invoiceActive ? 1 : 0,
        invoice_number: merged.invoiceNumber ?? "",
        invoice_date: merged.invoiceDate ?? "",
        invoice_contract: merged.invoiceContract ?? "",
        created_at: merged.createdAt || existing.createdAt || "",
      })
  // A new amount (items added / edited) moves the totals with it: the card, the debt pages and the balances read these columns.
  if (patch.amount !== undefined && patch.amount !== existing.amount && patch.orderBalance === undefined) {
    await db
      .prepare(
        `UPDATE orders SET total_price = @total, fact_price = @total - COALESCE(return_price, 0),
         order_balance = @total - COALESCE(return_price, 0) - COALESCE(paid_amount, 0) WHERE id = @id`,
      )
      .run({ id, total: amountNumber(merged.amount) })
  }
  return (await getOrder(id))
}

export async function deleteOrder(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM orders WHERE id = ?").run(id))
  return result.changes > 0
}
