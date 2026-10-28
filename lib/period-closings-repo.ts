import "server-only"

import { getDb } from "@/lib/db"

export type PeriodClosing = {
  id: number
  className: string
  name: string
  isAuto: boolean
  date: string | null
  days: number
}

type Row = { id: number; class_name: string; name: string; is_auto: number; closing_date: string; days: number }

export type PeriodClosingInput = { isAuto: boolean; date: string | null; days: number }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS period_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_name TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_auto INTEGER NOT NULL DEFAULT 1,
      closing_date TEXT NOT NULL DEFAULT '',
      days INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  const count = Number(((await db.prepare("SELECT COUNT(*) AS count FROM period_closings").get()) as { count: number | string }).count)
  if (count === 0) {
    const seed = db.prepare("INSERT INTO period_closings (id, class_name, name, is_auto, days) VALUES (@id, @class_name, @name, 1, @days)")
    await seed.run({ id: 1, class_name: "order", name: "Заказ", days: 1 })
    await seed.run({ id: 2, class_name: "transaction", name: "Касса", days: 1 })
    await seed.run({ id: 3, class_name: "orderreturn", name: "Возврат", days: 2 })
    await db.exec("SELECT setval(pg_get_serial_sequence('period_closings', 'id'), 3)")
  }
}

function rowToClosing(row: Row): PeriodClosing {
  return { id: row.id, className: row.class_name, name: row.name, isAuto: Boolean(row.is_auto), date: row.closing_date || null, days: row.days }
}

/** The reference lists the document kinds alphabetically (Возврат, Заказ, Касса). */
export async function listPeriodClosings(): Promise<PeriodClosing[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM period_closings ORDER BY name ASC").all()) as Row[]).map(rowToClosing)
}

export async function updatePeriodClosing(id: number, input: PeriodClosingInput): Promise<PeriodClosing | null> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare("UPDATE period_closings SET is_auto = @isAuto, closing_date = @date, days = @days, updated_at = datetime('now') WHERE id = @id")
    .run({ id, isAuto: input.isAuto ? 1 : 0, date: input.isAuto ? "" : input.date ?? "", days: input.isAuto ? input.days : 0 })
  if (!result.changes) return null
  const row = (await db.prepare("SELECT * FROM period_closings WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToClosing(row) : null
}
