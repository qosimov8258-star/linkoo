import "server-only"

import { getDb } from "@/lib/db"

export type CashbackWithdrawalStatus = "pending" | "confirmed" | "rejected"

export type CashbackWithdrawalRequest = {
  id: number
  client: string
  amount: number
  currency: string
  status: CashbackWithdrawalStatus
}

type Row = {
  id: number
  client: string
  amount: number
  currency: string
  status: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cashback_withdrawal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'SUM',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToRequest(row: Row): CashbackWithdrawalRequest {
  const status: CashbackWithdrawalStatus = row.status === "confirmed" || row.status === "rejected" ? row.status : "pending"
  return { id: row.id, client: row.client, amount: row.amount, currency: row.currency, status }
}

export type CashbackWithdrawalRequestInput = { client: string; amount: number; currency: string }

export function parseCashbackWithdrawalRequestInput(body: unknown): CashbackWithdrawalRequestInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const client = typeof value.client === "string" ? value.client.trim() : ""
  if (!client) return null
  const amount = typeof value.amount === "number" ? value.amount : Number(value.amount)
  if (!Number.isFinite(amount)) return null
  const currency = typeof value.currency === "string" && value.currency.trim() ? value.currency.trim() : "SUM"
  return { client, amount, currency }
}

export async function listCashbackWithdrawalRequests(): Promise<CashbackWithdrawalRequest[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT id, client, amount, currency, status FROM cashback_withdrawal_requests ORDER BY id DESC").all()) as Row[]).map(rowToRequest)
}

export async function getCashbackWithdrawalRequest(id: number): Promise<CashbackWithdrawalRequest | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT id, client, amount, currency, status FROM cashback_withdrawal_requests WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToRequest(row) : null
}

export async function createCashbackWithdrawalRequest(input: CashbackWithdrawalRequestInput): Promise<CashbackWithdrawalRequest> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO cashback_withdrawal_requests (client, amount, currency) VALUES (@client, @amount, @currency)")
      .run(input))
  return (await getCashbackWithdrawalRequest(Number(result.lastInsertRowid)))!
}

export async function updateCashbackWithdrawalRequestStatus(id: number, status: CashbackWithdrawalStatus): Promise<CashbackWithdrawalRequest | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getCashbackWithdrawalRequest(id))) return null
  await db.prepare("UPDATE cashback_withdrawal_requests SET status = @status, updated_at = datetime('now') WHERE id = @id").run({ id, status })
  return (await getCashbackWithdrawalRequest(id))
}
