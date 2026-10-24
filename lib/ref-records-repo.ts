import "server-only"

import { getDb } from "@/lib/db"

// Generic JSON document store for the "Продажи" pages that mirror the reference app's lists (returns, promotions,
// mailings, surveys, ...). Each page keeps its own row shape in `data`; rows are soft-deleted so a cancelled record
// never reappears from a seed and nothing is ever physically removed.

export const REF_KINDS = ["return", "return-detail", "refusal", "promo", "mailing", "survey", "survey-plan", "bonus", "gear", "photo", "tg-page", "draft-order", "shift"] as const
export type RefKind = (typeof REF_KINDS)[number]

/** Lists the reference shows newest (highest id) first; the other lists keep their stored order. */
const NEWEST_FIRST: RefKind[] = ["return", "return-detail", "refusal", "promo", "mailing", "draft-order"]

export type RefRecord<T = Record<string, unknown>> = { id: string; data: T }

export function isRefKind(value: string): value is RefKind {
  return (REF_KINDS as readonly string[]).includes(value)
}

type Row = { id: string; data: string }

async function ensure(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ref_records (
      seq BIGINT GENERATED ALWAYS AS IDENTITY,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, id)
    );
  `)
}

/** Records in the order the reference list shows them: the physical insertion order (seeds keep the reference order). */
export async function listRecords(kind: RefKind): Promise<RefRecord[]> {
  const db = getDb()
  await ensure(db)
  const order = NEWEST_FIRST.includes(kind) ? `CASE WHEN id ~ '^[0-9]+$' THEN CAST(id AS BIGINT) END DESC NULLS LAST, seq DESC` : `seq ASC`
  const rows = (await db.prepare(`SELECT id, data FROM ref_records WHERE kind = ? AND deleted = 0 ORDER BY ${order}`).all(kind)) as Row[]
  return rows.map((row) => ({ id: row.id, data: JSON.parse(row.data) }))
}

export async function getRecord(kind: RefKind, id: string): Promise<RefRecord | null> {
  const db = getDb()
  await ensure(db)
  const row = (await db.prepare(`SELECT id, data FROM ref_records WHERE kind = ? AND id = ? AND deleted = 0`).get(kind, id)) as Row | undefined
  return row ? { id: row.id, data: JSON.parse(row.data) } : null
}

/** New numeric id = max existing numeric id of the kind + 1 (the reference numbers new documents the same way). */
export async function createRecord(kind: RefKind, data: Record<string, unknown>, id?: string): Promise<RefRecord> {
  const db = getDb()
  await ensure(db)
  let nextId = id
  if (!nextId) {
    const row = (await db.prepare(`SELECT COALESCE(MAX(CAST(id AS BIGINT)), 0) AS max FROM ref_records WHERE kind = ? AND id ~ '^[0-9]+$'`).get(kind)) as { max: number | string }
    nextId = String(Number(row?.max ?? 0) + 1)
  }
  const stored = { ...data, id: /^\d+$/.test(nextId) ? Number(nextId) : nextId }
  await db.prepare(`INSERT INTO ref_records (kind, id, data) VALUES (?, ?, ?)`).run(kind, nextId, JSON.stringify(stored))
  return { id: nextId, data: stored }
}

export async function updateRecord(kind: RefKind, id: string, patch: Record<string, unknown>): Promise<RefRecord | null> {
  const db = getDb()
  const current = await getRecord(kind, id)
  if (!current) return null
  const data = { ...current.data, ...patch, id: current.data.id }
  await db.prepare(`UPDATE ref_records SET data = ?, updated_at = datetime('now') WHERE kind = ? AND id = ?`).run(JSON.stringify(data), kind, id)
  return { id, data }
}

export async function deleteRecord(kind: RefKind, id: string): Promise<boolean> {
  const db = getDb()
  await ensure(db)
  const result = await db.prepare(`UPDATE ref_records SET deleted = 1, updated_at = datetime('now') WHERE kind = ? AND id = ? AND deleted = 0`).run(kind, id)
  return result.changes > 0
}
