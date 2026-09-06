import "server-only"

import { getDb } from "@/lib/db"

export type JobPosition = { id: number; name: string; date: string }

type Row = { id: number; name: string; created_at: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS job_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      .format(new Date(iso.replace(" ", "T") + "Z"))
      .replace(".", "")
  } catch {
    return iso
  }
}

function rowToPosition(row: Row): JobPosition {
  return { id: row.id, name: row.name, date: formatDate(row.created_at) }
}

export type JobPositionInput = { name: string }

export async function listJobPositions(): Promise<JobPosition[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM job_positions ORDER BY id DESC").all()) as Row[]).map(rowToPosition)
}

export async function getJobPosition(id: number): Promise<JobPosition | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM job_positions WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToPosition(row) : null
}

export async function createJobPosition(input: JobPositionInput): Promise<JobPosition> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db.prepare("INSERT INTO job_positions (name) VALUES (@name)").run({ name: input.name }))
  return (await getJobPosition(Number(result.lastInsertRowid)))!
}

export async function updateJobPosition(id: number, input: JobPositionInput): Promise<JobPosition | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getJobPosition(id))) return null
  await db.prepare("UPDATE job_positions SET name = @name, updated_at = datetime('now') WHERE id = @id").run({ id, name: input.name })
  return (await getJobPosition(id))
}

export async function deleteJobPosition(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM job_positions WHERE id = ?").run(id)).changes > 0
}
