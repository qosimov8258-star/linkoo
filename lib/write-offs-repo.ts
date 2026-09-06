import "server-only"

import { getDb } from "@/lib/db"
import type { WriteOff, WriteOffItem } from "@/components/analytics/write-offs-data"

type WriteOffRow = {
  id: number
  creator: string
  warehouse: string
  date: string
  status: string
  comment: string
  reason: string
  items: string
}

function rowToWriteOff(row: WriteOffRow): WriteOff {
  return {
    id: row.id,
    creator: row.creator,
    warehouse: row.warehouse,
    date: row.date,
    status: row.status as WriteOff["status"],
    comment: row.comment,
    reason: row.reason,
    items: JSON.parse(row.items) as WriteOffItem[],
  }
}

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function formatToday() {
  const date = new Date()
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

export type WriteOffInput = { warehouse: string; reason: string; comment: string; items: WriteOffItem[] }

export function parseWriteOffInput(body: unknown): WriteOffInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const warehouse = typeof value.warehouse === "string" ? value.warehouse.trim() : ""
  const reason = typeof value.reason === "string" ? value.reason.trim() : ""
  const items = Array.isArray(value.items) ? (value.items as WriteOffItem[]) : []
  if (!warehouse || !reason || items.length === 0) return null
  return {
    warehouse,
    reason,
    comment: typeof value.comment === "string" ? value.comment : "",
    items: items.map((item, index) => ({
      id: Number(item.id) || index + 1,
      product: String(item.product ?? ""),
      code: String(item.code ?? "-"),
      series: String(item.series ?? "-"),
      block: Number(item.block) || 0,
      qty: Number(item.qty) || 0,
      cost: Number(item.cost) || 0,
      sum: (Number(item.qty) || 0) * (Number(item.cost) || 0),
    })),
  }
}

export async function listWriteOffs(): Promise<WriteOff[]> {
  const db = getDb()
  return ((await db.prepare("SELECT * FROM write_offs ORDER BY id DESC").all()) as WriteOffRow[]).map(rowToWriteOff)
}

export async function getWriteOff(id: number): Promise<WriteOff | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM write_offs WHERE id = ?").get(id)) as WriteOffRow | undefined
  return row ? rowToWriteOff(row) : null
}

export async function createWriteOff(input: WriteOffInput): Promise<WriteOff> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO write_offs (creator, warehouse, date, status, comment, reason, items, updated_at)
       VALUES ('Admin Ritm', @warehouse, @date, 'закрыт', @comment, @reason, @items, datetime('now'))`,
      )
      .run({
        warehouse: input.warehouse,
        date: formatToday(),
        comment: input.comment,
        reason: input.reason,
        items: JSON.stringify(input.items),
      }))
  return (await getWriteOff(Number(result.lastInsertRowid)))!
}

export async function deleteWriteOff(id: number): Promise<boolean> {
  const db = getDb()
  return (await db.prepare("DELETE FROM write_offs WHERE id = ?").run(id)).changes > 0
}
