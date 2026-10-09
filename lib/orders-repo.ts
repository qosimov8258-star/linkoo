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
       ALTER TABLE orders ADD COLUMN IF NOT EXISTS organization TEXT NOT NULL DEFAULT '';`,
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
  const rows = search
    ? ((await db.prepare("SELECT * FROM orders WHERE client LIKE ? OR agent LIKE ? ORDER BY id DESC").all(
              `%${search}%`,
              `%${search}%`,
            )) as OrderRow[])
    : ((await db.prepare("SELECT * FROM orders ORDER BY id DESC").all()) as OrderRow[])
  return rows.map(rowToOrder)
}

export async function getOrder(id: number): Promise<Order | null> {
  await ensurePaymentColumns()
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM orders WHERE id = ?").get(id)) as OrderRow | undefined
  return row ? rowToOrder(row) : null
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

export async function createOrder(input: Partial<OrderInput>): Promise<Order> {
  await ensurePaymentColumns()
  const db = getDb()
  const cleaned = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<OrderInput>
  const values = { ...defaultOrder, ...cleaned }
  const result = (await db
      .prepare(
        `INSERT INTO orders (client, zone, type, product, created, delivery, agent, amount, balance, negative, status, discount,
         payment_date, payment_type, organization)
       VALUES (@client, @zone, @type, @product, @created, @delivery, @agent, @amount, @balance, @negative, @status, @discount,
         @payment_date, @payment_type, @organization)`,
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
       organization = @organization, updated_at = datetime('now')
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
      })
  return (await getOrder(id))
}

export async function deleteOrder(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM orders WHERE id = ?").run(id))
  return result.changes > 0
}
