import "server-only"

import { getDb } from "@/lib/db"

export type FinancialAccount = {
  id: number
  name: string
  address: string
  createdAt: string
  agent: string
  type: string
}

type Row = { id: number; name: string; address: string; created_at: string; agent: string; type: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS financial_accounts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT ''
    );
  `)
}

export async function listFinancialAccounts(): Promise<FinancialAccount[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db.prepare("SELECT * FROM financial_accounts ORDER BY id DESC").all()) as Row[]
  return rows.map((row) => ({ id: row.id, name: row.name, address: row.address, createdAt: row.created_at, agent: row.agent, type: row.type }))
}
