import "server-only"

import { getDb } from "@/lib/db"

export type OrderTimeRestriction = {
  id: number
  name: string
  from: string
  to: string
  fullDay: boolean
}

type Row = {
  id: number
  name: string
  from_time: string
  to_time: string
  full_day: number
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS order_time_restrictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      from_time TEXT NOT NULL DEFAULT '00:00',
      to_time TEXT NOT NULL DEFAULT '23:59',
      full_day INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  const count = ((await db.prepare("SELECT COUNT(*) AS count FROM order_time_restrictions").get()) as { count: number }).count
  if (count === 0) {
    const seed = db.prepare(
      "INSERT INTO order_time_restrictions (name, from_time, to_time, full_day) VALUES (@name, @from_time, @to_time, @full_day)",
    )
    seed.run({ name: "Создания заказа", from_time: "00:00", to_time: "23:59", full_day: 1 })
    seed.run({ name: "Редактировать заказ", from_time: "00:00", to_time: "23:59", full_day: 1 })
  }
}

function rowToRestriction(row: Row): OrderTimeRestriction {
  return { id: row.id, name: row.name, from: row.from_time, to: row.to_time, fullDay: Boolean(row.full_day) }
}

export type OrderTimeRestrictionInput = {
  name: string
  from: string
  to: string
  fullDay: boolean
}

export async function listOrderTimeRestrictions(): Promise<OrderTimeRestriction[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM order_time_restrictions ORDER BY id ASC").all()) as Row[]).map(rowToRestriction)
}

export async function getOrderTimeRestriction(id: number): Promise<OrderTimeRestriction | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM order_time_restrictions WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToRestriction(row) : null
}

export async function createOrderTimeRestriction(input: OrderTimeRestrictionInput): Promise<OrderTimeRestriction> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO order_time_restrictions (name, from_time, to_time, full_day)
       VALUES (@name, @from, @to, @fullDay)`,
      )
      .run({ name: input.name, from: input.from, to: input.to, fullDay: input.fullDay ? 1 : 0 }))
  return (await getOrderTimeRestriction(Number(result.lastInsertRowid)))!
}

export async function updateOrderTimeRestriction(id: number, input: OrderTimeRestrictionInput): Promise<OrderTimeRestriction | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getOrderTimeRestriction(id))) return null
  await db.prepare(
        `UPDATE order_time_restrictions SET name = @name, from_time = @from, to_time = @to, full_day = @fullDay,
       updated_at = datetime('now') WHERE id = @id`,
      ).run({ id, name: input.name, from: input.from, to: input.to, fullDay: input.fullDay ? 1 : 0 })
  return (await getOrderTimeRestriction(id))
}

export async function deleteOrderTimeRestriction(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM order_time_restrictions WHERE id = ?").run(id)).changes > 0
}
