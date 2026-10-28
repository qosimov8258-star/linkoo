import "server-only"

import { getDb } from "@/lib/db"
import { RECEIPT_POSITIONS, type ReceiptLine, type ReceiptTemplate, type ReceiptTemplateListResult, type ReceiptTemplatePayload } from "@/components/analytics/receipt-templates-data"

type Row = { id: number; name: string; print_auto_check: number; headers: string; footers: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS receipt_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      print_auto_check INTEGER NOT NULL DEFAULT 0,
      headers TEXT NOT NULL DEFAULT '[]',
      footers TEXT NOT NULL DEFAULT '[]'
    );
  `)
}

const parseLines = (value: string): ReceiptLine[] => {
  try {
    return JSON.parse(value) as ReceiptLine[]
  } catch {
    return []
  }
}

const toItem = (row: Row): ReceiptTemplate => ({ id: row.id, name: row.name, printAutoCheck: Boolean(row.print_auto_check), headers: parseLines(row.headers), footers: parseLines(row.footers) })

/** Lines without text are dropped; the position falls back to the left. */
export function cleanLines(lines: ReceiptLine[] | undefined): ReceiptLine[] {
  return (lines ?? [])
    .filter((line) => line && typeof line.name === "string" && line.name.trim())
    .map((line) => ({ name: line.name.trim(), isBold: Boolean(line.isBold), position: RECEIPT_POSITIONS.some((item) => item.id === line.position) ? line.position : "left" }))
}

export type ReceiptQuery = { search: string; ordering: string; page: number; pageSize: number }

export async function listReceiptTemplates(query: ReceiptQuery): Promise<ReceiptTemplateListResult> {
  const db = getDb()
  await ensureSchema(db)
  const search = query.search.trim()
  const where = "WHERE (@search = '' OR name ILIKE '%' || @search || '%')"
  const params = { search }
  const desc = query.ordering.startsWith("-")
  const column = query.ordering.replace(/^-/, "") === "print_auto_check" ? "print_auto_check" : query.ordering ? "lower(name)" : "id"
  const total = (await db.prepare(`SELECT count(*) AS n FROM receipt_templates ${where}`).get(params)) as { n: number | string }
  const rows = (await db
    .prepare(`SELECT id, name, print_auto_check, headers, footers FROM receipt_templates ${where} ORDER BY ${column} ${desc ? "DESC" : "ASC"}, id ASC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as Row[]
  return { count: Number(total.n), results: rows.map(toItem) }
}

export async function getReceiptTemplate(id: number): Promise<ReceiptTemplate | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT id, name, print_auto_check, headers, footers FROM receipt_templates WHERE id = ?").get(id)) as Row | undefined
  return row ? toItem(row) : null
}

export async function createReceiptTemplate(input: ReceiptTemplatePayload): Promise<ReceiptTemplate> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare("INSERT INTO receipt_templates (name, print_auto_check, headers, footers) VALUES (@name, @auto, @headers, @footers)")
    .run({ name: input.name.trim(), auto: input.printAutoCheck ? 1 : 0, headers: JSON.stringify(cleanLines(input.headers)), footers: JSON.stringify(cleanLines(input.footers)) })
  return (await getReceiptTemplate(Number(result.lastInsertRowid)))!
}

export async function updateReceiptTemplate(id: number, input: ReceiptTemplatePayload): Promise<ReceiptTemplate | null> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare("UPDATE receipt_templates SET name = @name, print_auto_check = @auto, headers = @headers, footers = @footers WHERE id = @id")
    .run({ id, name: input.name.trim(), auto: input.printAutoCheck ? 1 : 0, headers: JSON.stringify(cleanLines(input.headers)), footers: JSON.stringify(cleanLines(input.footers)) })
  return result.changes ? getReceiptTemplate(id) : null
}

export async function deleteReceiptTemplate(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM receipt_templates WHERE id = ?").run(id)).changes > 0
}
