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
  }
}

export type OrderInput = Omit<Order, "id">
export type OrderPatch = Partial<OrderInput>

export function listOrders(search?: string): Order[] {
  const db = getDb()
  const rows = search
    ? (db.prepare("SELECT * FROM orders WHERE client LIKE ? OR agent LIKE ? ORDER BY id DESC").all(
        `%${search}%`,
        `%${search}%`,
      ) as OrderRow[])
    : (db.prepare("SELECT * FROM orders ORDER BY id DESC").all() as OrderRow[])
  return rows.map(rowToOrder)
}

export function getOrder(id: number): Order | null {
  const db = getDb()
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined
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

export function createOrder(input: Partial<OrderInput>): Order {
  const db = getDb()
  const cleaned = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<OrderInput>
  const values = { ...defaultOrder, ...cleaned }
  const result = db
    .prepare(
      `INSERT INTO orders (client, zone, type, product, created, delivery, agent, amount, balance, negative, status, discount)
       VALUES (@client, @zone, @type, @product, @created, @delivery, @agent, @amount, @balance, @negative, @status, @discount)`,
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
    })
  return getOrder(Number(result.lastInsertRowid))!
}

export function updateOrder(id: number, patch: OrderPatch): Order | null {
  const existing = getOrder(id)
  if (!existing) return null

  const merged: OrderInput = { ...existing, ...patch }
  const db = getDb()
  db.prepare(
    `UPDATE orders SET client = @client, zone = @zone, type = @type, product = @product, created = @created,
       delivery = @delivery, agent = @agent, amount = @amount, balance = @balance, negative = @negative,
       status = @status, discount = @discount, updated_at = datetime('now')
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
  })
  return getOrder(id)
}

export function deleteOrder(id: number): boolean {
  const db = getDb()
  const result = db.prepare("DELETE FROM orders WHERE id = ?").run(id)
  return result.changes > 0
}
