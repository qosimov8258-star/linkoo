import "server-only"

import { getDb } from "@/lib/db"

export type Money = { euro: number; sum: number; usd: number }
export type LoyaltyTransaction = { id: number; type: string; action: string; date: string; amount: number; currency: keyof Money }
export type LoyaltyCardClient = { id: number; client: string; balance: Money; transactions: LoyaltyTransaction[] }

type TxRow = {
  id: number
  client_id: number
  currency: string
  amount: number
  comment: string
  created_at: string
}

type ClientRow = { id: number; name: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS loyalty_card_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'sum',
      amount REAL NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function formatDate(sqliteDate: string): string {
  const isoLike = sqliteDate.includes("T") ? sqliteDate : `${sqliteDate.replace(" ", "T")}Z`
  const date = new Date(isoLike)
  if (Number.isNaN(date.getTime())) return sqliteDate
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
}

function normalizeCurrency(value: unknown): keyof Money {
  return value === "euro" || value === "usd" ? value : "sum"
}

export async function listLoyaltyCardClients(): Promise<LoyaltyCardClient[]> {
  const db = getDb()
  await ensureSchema(db)
  const clients = (await db.prepare("SELECT id, name FROM clients ORDER BY id DESC").all()) as ClientRow[]
  const allTx = (await db.prepare("SELECT * FROM loyalty_card_transactions ORDER BY id DESC").all()) as TxRow[]

  const txByClient = new Map<number, TxRow[]>()
  for (const tx of allTx) {
    const list = txByClient.get(tx.client_id) ?? []
    list.push(tx)
    txByClient.set(tx.client_id, list)
  }

  return clients.map((client) => {
    const txs = txByClient.get(client.id) ?? []
    const balance: Money = { euro: 0, sum: 0, usd: 0 }
    const transactions: LoyaltyTransaction[] = txs.map((tx) => {
      const currency = normalizeCurrency(tx.currency)
      balance[currency] += tx.amount
      return {
        id: tx.id,
        type: tx.comment || "Не указано",
        action: tx.amount >= 0 ? "Приход" : "Расход",
        date: formatDate(tx.created_at),
        amount: tx.amount,
        currency,
      }
    })
    return { id: client.id, client: client.name, balance, transactions }
  })
}

export type LoyaltyTransactionInput = {
  clientId: number
  currency: keyof Money
  amount: number
  kind: "add" | "expense"
  comment: string
}

export async function createLoyaltyCardTransaction(input: LoyaltyTransactionInput): Promise<LoyaltyCardClient | null> {
  const db = getDb()
  await ensureSchema(db)
  const client = (await db.prepare("SELECT id, name FROM clients WHERE id = ?").get(input.clientId)) as ClientRow | undefined
  if (!client) return null

  const signedAmount = input.kind === "add" ? input.amount : -input.amount
  await db.prepare(
        `INSERT INTO loyalty_card_transactions (client_id, currency, amount, comment) VALUES (@clientId, @currency, @amount, @comment)`,
      ).run({ clientId: input.clientId, currency: input.currency, amount: signedAmount, comment: input.comment })

  return (await listLoyaltyCardClients()).find((item) => item.id === input.clientId) ?? null
}
