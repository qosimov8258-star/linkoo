import "server-only"

import { getDb, withTransaction } from "@/lib/db"

type Row = { day: number }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_weekend_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      day INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, month, day)
    );
  `)
}

export type WeekendDaysInput = {
  year: number
  month: number
  days: number[]
}

export function parseWeekendDaysInput(body: unknown): WeekendDaysInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const year = typeof value.year === "number" && Number.isFinite(value.year) ? value.year : null
  const month = typeof value.month === "number" && Number.isFinite(value.month) && value.month >= 0 && value.month <= 11 ? value.month : null
  if (year === null || month === null) return null
  const days = Array.isArray(value.days)
    ? value.days.filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 1 && item <= 31)
    : []
  return { year, month, days }
}

export async function listWeekendDays(year: number, month: number): Promise<number[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db
      .prepare("SELECT day FROM attendance_weekend_days WHERE year = ? AND month = ? ORDER BY day ASC")
      .all(year, month)) as Row[]
  return rows.map((row) => row.day)
}

/** Replaces the full set of custom marked weekend/holiday days for a given
 * year+month with the provided list (delete then re-insert), so re-saving
 * the modal doesn't pile up stale or duplicate day rows. */
export async function replaceWeekendDays(input: WeekendDaysInput): Promise<number[]> {
  await ensureSchema(getDb())
  await withTransaction(async (db) => {
    await db.prepare("DELETE FROM attendance_weekend_days WHERE year = ? AND month = ?").run(input.year, input.month)
    const insert = db.prepare("INSERT OR IGNORE INTO attendance_weekend_days (year, month, day) VALUES (?, ?, ?)")
    for (const day of input.days) await insert.run(input.year, input.month, day)
  })
  return listWeekendDays(input.year, input.month)
}
