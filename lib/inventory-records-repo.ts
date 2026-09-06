import "server-only"

import { getDb } from "@/lib/db"

export type InventoryStatus = "Подтвержденный" | "В ожидании" | "Отменен"

export type InventoryRecord = {
  id: number
  warehouse: string
  author: string
  date: string
  comment: string
  status: InventoryStatus
  amount: string
}

type Row = {
  id: number
  warehouse: string
  author: string
  comment: string
  status: string
  amount: string
  created_at: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warehouse TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT 'Admin Ritm',
      comment TEXT NOT NULL DEFAULT 'Комментариев нет',
      status TEXT NOT NULL DEFAULT 'В ожидании',
      amount TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" })
      .format(new Date(iso.replace(" ", "T") + "Z"))
      .replace(".", "")
  } catch {
    return iso
  }
}

function isStatus(value: string): value is InventoryStatus {
  return value === "Подтвержденный" || value === "В ожидании" || value === "Отменен"
}

function rowToRecord(row: Row): InventoryRecord {
  return {
    id: row.id,
    warehouse: row.warehouse,
    author: row.author,
    date: formatDate(row.created_at),
    comment: row.comment,
    status: isStatus(row.status) ? row.status : "В ожидании",
    amount: row.amount,
  }
}

export type InventoryRecordInput = { warehouse: string; comment: string }

export type InventoryCommentInput = { comment: string }

export async function listInventoryRecords(): Promise<InventoryRecord[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM inventory_records ORDER BY id DESC").all()) as Row[]).map(rowToRecord)
}

export async function getInventoryRecord(id: number): Promise<InventoryRecord | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM inventory_records WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToRecord(row) : null
}

export async function createInventoryRecord(input: InventoryRecordInput): Promise<InventoryRecord> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO inventory_records (warehouse, author, comment, status, amount) VALUES (@warehouse, 'Admin Ritm', @comment, 'В ожидании', '0')")
      .run({ warehouse: input.warehouse, comment: input.comment }))
  return (await getInventoryRecord(Number(result.lastInsertRowid)))!
}

export async function updateInventoryComment(id: number, input: InventoryCommentInput): Promise<InventoryRecord | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getInventoryRecord(id))) return null
  await db.prepare("UPDATE inventory_records SET comment = @comment, updated_at = datetime('now') WHERE id = @id").run({ id, comment: input.comment })
  return (await getInventoryRecord(id))
}

export async function cancelInventoryRecord(id: number): Promise<InventoryRecord | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getInventoryRecord(id))) return null
  await db.prepare("UPDATE inventory_records SET status = 'Отменен', updated_at = datetime('now') WHERE id = @id").run({ id })
  return (await getInventoryRecord(id))
}

export async function deleteInventoryRecord(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM inventory_records WHERE id = ?").run(id)).changes > 0
}
