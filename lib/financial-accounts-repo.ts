import "server-only"

import { getDb } from "@/lib/db"

export type FinancialAccount = {
  id: number
  name: string
  address: string
  createdAt: string
  agent: string
  type: string
  deleted: boolean
  /** Shops (clients rows) that belong to this account. */
  markets: { id: number; name: string }[]
}

type Row = { id: number; name: string; address: string; created_at: string; agent: string; type: string; deleted?: number }

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
  await db.exec(`ALTER TABLE financial_accounts ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS financial_account_id INTEGER;`)
  // Shop -> account links kept apart from `clients` (a shop belongs to exactly one account).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS financial_account_markets (
      client_id INTEGER PRIMARY KEY,
      financial_account_id INTEGER NOT NULL
    );
  `)
}

export async function listFinancialAccounts(): Promise<FinancialAccount[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db.prepare("SELECT * FROM financial_accounts ORDER BY id DESC").all()) as Row[]
  const shops = (await db
    .prepare(
      `SELECT c.id, c.name, COALESCE(m.financial_account_id, c.financial_account_id) AS financial_account_id
         FROM clients c
         LEFT JOIN financial_account_markets m ON m.client_id = c.id
        WHERE COALESCE(m.financial_account_id, c.financial_account_id) IS NOT NULL
        ORDER BY c.id`,
    )
    .all()) as { id: number; name: string; financial_account_id: number }[]
  const byAccount = new Map<number, { id: number; name: string }[]>()
  for (const shop of shops) {
    const list = byAccount.get(shop.financial_account_id) ?? []
    list.push({ id: shop.id, name: shop.name })
    byAccount.set(shop.financial_account_id, list)
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    address: row.address,
    createdAt: row.created_at,
    agent: row.agent,
    type: row.type,
    deleted: Boolean(row.deleted),
    markets: byAccount.get(row.id) ?? [],
  }))
}

export async function updateFinancialAccount(id: number, input: { name: string; address: string }): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("UPDATE financial_accounts SET name = @name, address = @address WHERE id = @id").run({ name: input.name, address: input.address, id })).changes > 0
}

/** Accounts are soft-deleted: the "Показать удаленные счета" filter brings them back into the list. */
export async function deleteFinancialAccount(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("UPDATE financial_accounts SET deleted = 1 WHERE id = ?").run(id)).changes > 0
}

/** Creating a client opens its own financial account (the demo does it with the client's name, address, agent and type). */
export async function createAccountForClient(client: { id: number; name: string; address?: string; agent?: string; type?: string }): Promise<number> {
  const db = getDb()
  await ensureSchema(db)
  const next = (await db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM financial_accounts").get()) as { id: number }
  const id = Number(next.id)
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  const createdAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  await db
    .prepare("INSERT INTO financial_accounts (id, name, address, created_at, agent, type) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, client.name, client.address ?? "", createdAt, client.agent && client.agent !== "Не указано" ? client.agent : "", client.type ?? "")
  await db.prepare("INSERT INTO financial_account_markets (client_id, financial_account_id) VALUES (?, ?) ON CONFLICT (client_id) DO NOTHING RETURNING client_id").run(client.id, id)
  return id
}

/** Deleting a client releases its link; an account left without any shop is soft-deleted with it. */
export async function releaseClientAccount(clientId: number): Promise<void> {
  const db = getDb()
  await ensureSchema(db)
  const link = (await db.prepare("SELECT financial_account_id AS id FROM financial_account_markets WHERE client_id = ?").get(clientId)) as { id: number } | undefined
  if (!link) return
  await db.prepare("DELETE FROM financial_account_markets WHERE client_id = ?").run(clientId)
  const left = (await db.prepare("SELECT COUNT(*) AS n FROM financial_account_markets WHERE financial_account_id = ?").get(link.id)) as { n: number | string }
  if (Number(left.n) === 0) await deleteFinancialAccount(link.id)
}
