import "server-only"

import { getDb } from "@/lib/db"

export type CashManagementEntry = {
  id: number
  cashboxId: number
  description: string
  category: string
  clientName: string
  branch: string
  organization: string
  comment: string
  date: string
  amount: number
}

type Row = {
  id: number
  cashbox_id: number
  description: string
  category: string
  client_name: string
  branch: string
  organization: string
  comment: string
  entry_date: string
  amount: number
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cash_management_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashbox_id INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      entry_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToEntry(row: Row): CashManagementEntry {
  return {
    id: row.id,
    cashboxId: row.cashbox_id,
    description: row.description,
    category: row.category,
    clientName: row.client_name,
    branch: row.branch,
    organization: row.organization,
    comment: row.comment,
    date: row.entry_date,
    amount: row.amount,
  }
}

export type CashManagementEntryInput = {
  cashboxId: number
  description: string
  category: string
  clientName: string
  branch: string
  organization: string
  comment: string
  date: string
  amount: number
}

export function parseCashManagementEntryInput(body: unknown): CashManagementEntryInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const cashboxId = typeof value.cashboxId === "number" ? value.cashboxId : Number(value.cashboxId)
  if (!Number.isFinite(cashboxId)) return null
  const amount = typeof value.amount === "number" ? value.amount : Number(value.amount)
  if (!Number.isFinite(amount)) return null
  const date = typeof value.date === "string" && value.date ? value.date : new Date().toISOString()
  return {
    cashboxId,
    description: typeof value.description === "string" ? value.description : "",
    category: typeof value.category === "string" ? value.category : "",
    clientName: typeof value.clientName === "string" ? value.clientName : "",
    branch: typeof value.branch === "string" ? value.branch : "",
    organization: typeof value.organization === "string" ? value.organization : "",
    comment: typeof value.comment === "string" ? value.comment : "",
    date,
    amount,
  }
}

export async function listCashManagementEntries(cashboxId?: number): Promise<CashManagementEntry[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = cashboxId
    ? ((await db.prepare("SELECT * FROM cash_management_entries WHERE cashbox_id = ? ORDER BY id DESC").all(cashboxId)) as Row[])
    : ((await db.prepare("SELECT * FROM cash_management_entries ORDER BY id DESC").all()) as Row[])
  return rows.map(rowToEntry)
}

export async function getCashManagementEntry(id: number): Promise<CashManagementEntry | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM cash_management_entries WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToEntry(row) : null
}

export async function createCashManagementEntry(input: CashManagementEntryInput): Promise<CashManagementEntry> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO cash_management_entries
        (cashbox_id, description, category, client_name, branch, organization, comment, entry_date, amount)
       VALUES (@cashboxId, @description, @category, @clientName, @branch, @organization, @comment, @date, @amount)`,
      )
      .run(input))
  return (await getCashManagementEntry(Number(result.lastInsertRowid)))!
}

export async function updateCashManagementEntry(id: number, input: CashManagementEntryInput): Promise<CashManagementEntry | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getCashManagementEntry(id))) return null
  await db.prepare(
        `UPDATE cash_management_entries SET
       cashbox_id = @cashboxId, description = @description, category = @category, client_name = @clientName,
       branch = @branch, organization = @organization, comment = @comment, entry_date = @date, amount = @amount,
       updated_at = datetime('now')
     WHERE id = @id`,
      ).run({ id, ...input })
  return (await getCashManagementEntry(id))
}

export async function deleteCashManagementEntry(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM cash_management_entries WHERE id = ?").run(id)).changes > 0
}
