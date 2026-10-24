import "server-only"

import { getDb } from "@/lib/db"

export type TimeRestrictionStatus = "1" | "2" | "3" | "4"

export const TIME_RESTRICTION_STATUSES: TimeRestrictionStatus[] = ["1", "2", "3", "4"]

export type OrderTimeRestriction = {
  id: number
  name: string
  status: TimeRestrictionStatus
  from: string | null
  to: string | null
  isAll: boolean
}

type Row = {
  id: number
  name: string
  status: string
  from_time: string
  to_time: string
  is_all: number
}

export type OrderTimeRestrictionInput = {
  status: TimeRestrictionStatus
  from: string | null
  to: string | null
  isAll: boolean
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS order_time_restrictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      from_time TEXT NOT NULL DEFAULT '',
      to_time TEXT NOT NULL DEFAULT '',
      full_day INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT '1',
      is_all INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE order_time_restrictions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '1';
    ALTER TABLE order_time_restrictions ADD COLUMN IF NOT EXISTS is_all INTEGER NOT NULL DEFAULT 1;
  `)
  const count = Number(((await db.prepare("SELECT COUNT(*) AS count FROM order_time_restrictions").get()) as { count: number | string }).count)
  if (count === 0) {
    const seed = db.prepare("INSERT INTO order_time_restrictions (name, status, is_all) VALUES (@name, '1', @is_all)")
    await seed.run({ name: "Создания заказа", is_all: 1 })
    await seed.run({ name: "Редактировать заказ", is_all: 0 })
  }
}

function rowToRestriction(row: Row): OrderTimeRestriction {
  return {
    id: row.id,
    name: row.name,
    status: (TIME_RESTRICTION_STATUSES as string[]).includes(row.status) ? (row.status as TimeRestrictionStatus) : "1",
    from: row.from_time || null,
    to: row.to_time || null,
    isAll: Boolean(row.is_all),
  }
}

export async function listOrderTimeRestrictions(): Promise<OrderTimeRestriction[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM order_time_restrictions ORDER BY id ASC").all()) as Row[]).map(rowToRestriction)
}

export async function updateOrderTimeRestriction(id: number, input: OrderTimeRestrictionInput): Promise<OrderTimeRestriction | null> {
  const db = getDb()
  await ensureSchema(db)
  const hours = input.status === "3" || input.status === "4"
  const result = await db
    .prepare(
      `UPDATE order_time_restrictions SET status = @status, from_time = @from, to_time = @to, is_all = @isAll,
       full_day = @fullDay, updated_at = datetime('now') WHERE id = @id`,
    )
    .run({ id, status: input.status, from: hours ? input.from ?? "" : "", to: hours ? input.to ?? "" : "", isAll: input.isAll ? 1 : 0, fullDay: input.status === "1" ? 1 : 0 })
  if (!result.changes) return null
  const row = (await db.prepare("SELECT * FROM order_time_restrictions WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToRestriction(row) : null
}
