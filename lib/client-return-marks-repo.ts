import "server-only"

import { ensureClientReturnsSchema } from "@/lib/client-returns-repo"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { nowLocalIso } from "@/lib/finance/dates"

// Marking codes of the lines of a client return (Продажи → Возвраты → card → «Список товаров» → green «+»), like
// Linko's sales/order_return_product/<id>/get_marks/ and sales/order_return/add_marks/ (clear_other: true).
//
// client_return_item_marks(id, return_id → client_returns, item_id → client_return_items, both ON DELETE CASCADE,
// type, code, created_at, position, linko_id):
// - item_id: the line the codes belong to, as in Linko (codes of a returned product). The edit form updates the lines
//   that stay in place (they keep their ids) and deletes the removed ones, whose codes go with them; a new line starts
//   without codes;
// - type: consumer («Коды маркировки») | group («Коды агрегации») | transport («Коды транспортные»);
// - created_at: the scan moment, a local wall time "YYYY-MM-DD HH:mm" as Linko's dialog sends it (rows copied from
//   Linko keep its own value, which may carry seconds);
// - position: the order of the codes as they were saved (Linko lists them in that order);
// - linko_id: Linko's mark id for codes copied from Linko (a re-import updates them in place).
// Saving a line's codes replaces all of that line's codes (Linko's clear_other).

export type ReturnMarkType = "consumer" | "group" | "transport"
export const RETURN_MARK_TYPES: readonly ReturnMarkType[] = ["consumer", "group", "transport"]

export type ReturnItemMark = { id: number; type: ReturnMarkType; code: string; createdAt: string }
export type ReturnItemMarkInput = { type: ReturnMarkType; code: string; createdAt?: string }

/** At most this many codes per line (a pallet of consumer codes stays well under it). */
export const MAX_MARKS_PER_LINE = 5000

const COLUMNS: Array<[string, string]> = [
  ["return_id", "INTEGER NOT NULL REFERENCES client_returns(id) ON DELETE CASCADE"],
  ["item_id", "INTEGER REFERENCES client_return_items(id) ON DELETE CASCADE"],
  ["type", "TEXT NOT NULL DEFAULT 'consumer'"],
  ["code", "TEXT NOT NULL DEFAULT ''"],
  ["created_at", "TEXT NOT NULL DEFAULT ''"],
  ["position", "INTEGER NOT NULL DEFAULT 0"],
  ["linko_id", "INTEGER"],
]

const DDL = `
CREATE TABLE IF NOT EXISTS client_return_item_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ${COLUMNS.map(([name, type]) => `${name} ${type}`).join(",\n  ")}
);
${COLUMNS.filter(([name]) => name !== "return_id")
  .map(([name, type]) => `ALTER TABLE client_return_item_marks ADD COLUMN IF NOT EXISTS ${name} ${type};`)
  .join("\n")}
CREATE INDEX IF NOT EXISTS client_return_item_marks_item_idx ON client_return_item_marks (item_id);
CREATE UNIQUE INDEX IF NOT EXISTS client_return_item_marks_linko_idx ON client_return_item_marks (linko_id) WHERE linko_id IS NOT NULL;
`

const SCHEMA_VERSION = 2

declare global {
  var __linkoClientReturnMarksSchema: { version: number; ready: Promise<void> } | undefined
}

/** Creates client_return_item_marks once per process (after the returns' own tables). */
export function ensureClientReturnMarksSchema(): Promise<void> {
  if (globalThis.__linkoClientReturnMarksSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(async () => {
      await ensureClientReturnsSchema()
      await withTransaction(async (tx) => {
        // The client returns' schema lock: no other DDL of these tables runs meanwhile.
        await tx.exec("SELECT pg_advisory_xact_lock(72120933)")
        await tx.exec(DDL)
      })
    }).catch((error) => {
      globalThis.__linkoClientReturnMarksSchema = undefined
      throw error
    })
    globalThis.__linkoClientReturnMarksSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoClientReturnMarksSchema!.ready
}

/** Whether `itemId` is a line of return `returnId`. */
async function isLineOf(db: PgDb, returnId: number, itemId: number): Promise<boolean> {
  return Boolean(await db.prepare("SELECT id FROM client_return_items WHERE id = ? AND return_id = ?").get(itemId, returnId))
}

type MarkRow = { id: number; type: string; code: string; created_at: string }

const toMark = (row: MarkRow): ReturnItemMark => ({
  id: Number(row.id),
  type: (RETURN_MARK_TYPES as readonly string[]).includes(row.type) ? (row.type as ReturnMarkType) : "consumer",
  code: row.code,
  createdAt: row.created_at ?? "",
})

async function readMarks(db: PgDb, itemId: number): Promise<ReturnItemMark[]> {
  const rows = (await db.prepare("SELECT id, type, code, created_at FROM client_return_item_marks WHERE item_id = ? ORDER BY position, id").all(itemId)) as MarkRow[]
  return rows.map(toMark)
}

/** The codes of line `itemId` of return `returnId` in their saved order; null when the return has no such line. */
export async function listReturnItemMarks(returnId: number, itemId: number): Promise<ReturnItemMark[] | null> {
  await ensureClientReturnMarksSchema()
  const db = getDb()
  return (await isLineOf(db, returnId, itemId)) ? readMarks(db, itemId) : null
}

/** Linko's local "YYYY-MM-DD HH:mm" of now (Asia/Tashkent). */
const nowMinute = () => nowLocalIso().slice(0, 16).replace("T", " ")

/** «Завершить сканирование»: the line's codes become exactly `marks` (Linko's add_marks with clear_other: true). A
 * code is kept once per type (the first one); a code without a scan moment gets now. null when the return has no such
 * line. */
export async function replaceReturnItemMarks(returnId: number, itemId: number, marks: ReturnItemMarkInput[]): Promise<ReturnItemMark[] | null> {
  await ensureClientReturnMarksSchema()
  return withTransaction(async (tx) => {
    // One save of a return's codes at a time (and none while the return is being edited).
    const found = await tx.prepare("SELECT id FROM client_returns WHERE id = ? FOR UPDATE").get(returnId)
    if (!found || !(await isLineOf(tx, returnId, itemId))) return null
    // A code copied from Linko that stays keeps its Linko id, so a later import updates it instead of adding it again.
    const linkoIds = new Map<string, number>()
    for (const row of (await tx
      .prepare("SELECT type, code, linko_id FROM client_return_item_marks WHERE item_id = ? AND linko_id IS NOT NULL")
      .all(itemId)) as Array<{ type: string; code: string; linko_id: number }>) {
      linkoIds.set(`${row.type}\u0000${row.code}`, Number(row.linko_id))
    }
    await tx.prepare("DELETE FROM client_return_item_marks WHERE item_id = ?").run(itemId)
    const seen = new Set<string>()
    let position = 0
    for (const mark of marks) {
      const code = mark.code.trim()
      const id = `${mark.type}\u0000${code}`
      if (!code || seen.has(id)) continue
      seen.add(id)
      await tx
        .prepare(
          `INSERT INTO client_return_item_marks (return_id, item_id, type, code, created_at, position, linko_id)
           VALUES (@returnId, @itemId, @type, @code, @createdAt, @position, @linkoId)`,
        )
        .run({ returnId, itemId, type: mark.type, code, createdAt: mark.createdAt?.trim() || nowMinute(), position: position++, linkoId: linkoIds.get(id) ?? null })
    }
    return readMarks(tx, itemId)
  })
}
