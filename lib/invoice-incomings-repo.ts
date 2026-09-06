import "server-only"

import { getDb } from "@/lib/db"

export type InvoiceIncoming = {
  id: number
  documentNumber: string
  supplier: string
  date: string
  amount: number
  branch: string
  status: string
  note: string
}

type Row = {
  id: number
  document_number: string
  supplier: string
  date: string
  amount: number
  branch: string
  status: string
  note: string
}

export const INVOICE_INCOMING_STATUSES = ["Получен", "Проведён", "Отклонён"] as const

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_incomings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_number TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      branch TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Получен',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToInvoice(row: Row): InvoiceIncoming {
  return {
    id: row.id,
    documentNumber: row.document_number,
    supplier: row.supplier,
    date: row.date,
    amount: row.amount,
    branch: row.branch,
    status: row.status,
    note: row.note,
  }
}

export type InvoiceIncomingInput = {
  documentNumber: string
  supplier: string
  date: string
  amount: number
  branch: string
  status: string
  note: string
}

export async function listInvoiceIncomings(): Promise<InvoiceIncoming[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM invoice_incomings ORDER BY id DESC").all()) as Row[]).map(rowToInvoice)
}

export async function getInvoiceIncoming(id: number): Promise<InvoiceIncoming | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM invoice_incomings WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToInvoice(row) : null
}

export async function createInvoiceIncoming(input: InvoiceIncomingInput): Promise<InvoiceIncoming> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        "INSERT INTO invoice_incomings (document_number, supplier, date, amount, branch, status, note) VALUES (@documentNumber, @supplier, @date, @amount, @branch, @status, @note)",
      )
      .run(input))
  return (await getInvoiceIncoming(Number(result.lastInsertRowid)))!
}

export async function updateInvoiceIncoming(id: number, input: InvoiceIncomingInput): Promise<InvoiceIncoming | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getInvoiceIncoming(id))) return null
  await db.prepare(
        "UPDATE invoice_incomings SET document_number = @documentNumber, supplier = @supplier, date = @date, amount = @amount, branch = @branch, status = @status, note = @note, updated_at = datetime('now') WHERE id = @id",
      ).run({ id, ...input })
  return (await getInvoiceIncoming(id))
}

export async function deleteInvoiceIncoming(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM invoice_incomings WHERE id = ?").run(id)).changes > 0
}
