import "server-only"

import { getDb } from "@/lib/db"

export type Money = { sum: number; usd: number; eur: number }
export type Vansel = {
  id: number
  name: string
  opening: Money
  transferToWarehouse: Money
  transferReturn: Money
  cash: Money
  transferred: Money
}

type TxRow = {
  id: number
  employee_id: number
  currency: string
  amount: number
  created_at: string
}

type EmployeeRow = { id: number; first_name: string; last_name: string }

function zeroMoney(): Money {
  return { sum: 0, usd: 0, eur: 0 }
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS vansell_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'sum',
      amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function normalizeCurrency(value: unknown): keyof Money {
  return value === "usd" || value === "eur" ? value : "sum"
}

export async function listVansels(): Promise<Vansel[]> {
  const db = getDb()
  await ensureSchema(db)
  const employees = (await db.prepare("SELECT id, first_name, last_name FROM employees ORDER BY id DESC").all()) as EmployeeRow[]
  const allTx = (await db.prepare("SELECT * FROM vansell_transactions").all()) as TxRow[]

  const cashByEmployee = new Map<number, Money>()
  for (const tx of allTx) {
    const currency = normalizeCurrency(tx.currency)
    const money = cashByEmployee.get(tx.employee_id) ?? zeroMoney()
    money[currency] += tx.amount
    cashByEmployee.set(tx.employee_id, money)
  }

  return employees.map((employee) => ({
    id: employee.id,
    name: `${employee.first_name} ${employee.last_name}`.trim(),
    opening: zeroMoney(),
    transferToWarehouse: zeroMoney(),
    transferReturn: zeroMoney(),
    cash: cashByEmployee.get(employee.id) ?? zeroMoney(),
    transferred: zeroMoney(),
  }))
}

export type VansellTransactionInput = {
  vanselId: number
  currency: keyof Money
  amount: number
  kind: "add" | "expense"
}

export function parseVansellTransactionInput(body: unknown): VansellTransactionInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const vanselId = typeof value.vanselId === "number" ? value.vanselId : Number(value.vanselId)
  if (!vanselId || Number.isNaN(vanselId)) return null
  const amount = typeof value.amount === "number" ? value.amount : Number(value.amount)
  if (!amount || Number.isNaN(amount) || amount <= 0) return null
  const currency = normalizeCurrency(value.currency)
  const kind = value.kind === "expense" ? "expense" : "add"
  return { vanselId, currency, amount, kind }
}

export async function createVansellTransaction(input: VansellTransactionInput): Promise<Vansel | null> {
  const db = getDb()
  await ensureSchema(db)
  const employee = (await db.prepare("SELECT id, first_name, last_name FROM employees WHERE id = ?").get(input.vanselId)) as EmployeeRow | undefined
  if (!employee) return null

  const signedAmount = input.kind === "add" ? input.amount : -input.amount
  await db.prepare("INSERT INTO vansell_transactions (employee_id, currency, amount) VALUES (@vanselId, @currency, @amount)").run({
        vanselId: input.vanselId,
        currency: input.currency,
        amount: signedAmount,
      })

  return (await listVansels()).find((item) => item.id === input.vanselId) ?? null
}
