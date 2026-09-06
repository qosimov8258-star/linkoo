import "server-only"

import { getDb } from "@/lib/db"

export type StoreReconciliationRow = {
  id: number
  client: string
  connected: boolean
  debtTerm: string
  daysAfterPayment: number
  daysAfterOrder: number
  amountSum: number
  amountEuro: number
  sumCash: number
  sumTransfer: number
  usdCash: number
  usdTransfer: number
  euroCash: number
  euroTransfer: number
  orders: number
  altSumTransfer: number
  altAmountSum: number
}

type Row = {
  id: number
  client: string
  connected: number
  debt_term: string
  days_after_payment: number
  days_after_order: number
  amount_sum: number
  amount_euro: number
  sum_cash: number
  sum_transfer: number
  usd_cash: number
  usd_transfer: number
  euro_cash: number
  euro_transfer: number
  orders: number
  alt_sum_transfer: number
  alt_amount_sum: number
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS store_reconciliation_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client TEXT NOT NULL,
      connected INTEGER NOT NULL DEFAULT 0,
      debt_term TEXT NOT NULL DEFAULT '',
      days_after_payment INTEGER NOT NULL DEFAULT 0,
      days_after_order INTEGER NOT NULL DEFAULT 0,
      amount_sum REAL NOT NULL DEFAULT 0,
      amount_euro REAL NOT NULL DEFAULT 0,
      sum_cash REAL NOT NULL DEFAULT 0,
      sum_transfer REAL NOT NULL DEFAULT 0,
      usd_cash REAL NOT NULL DEFAULT 0,
      usd_transfer REAL NOT NULL DEFAULT 0,
      euro_cash REAL NOT NULL DEFAULT 0,
      euro_transfer REAL NOT NULL DEFAULT 0,
      orders INTEGER NOT NULL DEFAULT 0,
      alt_sum_transfer REAL NOT NULL DEFAULT 0,
      alt_amount_sum REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function rowToItem(row: Row): StoreReconciliationRow {
  return {
    id: row.id,
    client: row.client,
    connected: row.connected === 1,
    debtTerm: row.debt_term,
    daysAfterPayment: row.days_after_payment,
    daysAfterOrder: row.days_after_order,
    amountSum: row.amount_sum,
    amountEuro: row.amount_euro,
    sumCash: row.sum_cash,
    sumTransfer: row.sum_transfer,
    usdCash: row.usd_cash,
    usdTransfer: row.usd_transfer,
    euroCash: row.euro_cash,
    euroTransfer: row.euro_transfer,
    orders: row.orders,
    altSumTransfer: row.alt_sum_transfer,
    altAmountSum: row.alt_amount_sum,
  }
}

export type StoreReconciliationRowInput = Omit<StoreReconciliationRow, "id">

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function parseStoreReconciliationRowInput(body: unknown): StoreReconciliationRowInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const client = typeof value.client === "string" ? value.client.trim() : ""
  if (!client) return null
  return {
    client,
    connected: value.connected === true,
    debtTerm: typeof value.debtTerm === "string" ? value.debtTerm : "",
    daysAfterPayment: num(value.daysAfterPayment),
    daysAfterOrder: num(value.daysAfterOrder),
    amountSum: num(value.amountSum),
    amountEuro: num(value.amountEuro),
    sumCash: num(value.sumCash),
    sumTransfer: num(value.sumTransfer),
    usdCash: num(value.usdCash),
    usdTransfer: num(value.usdTransfer),
    euroCash: num(value.euroCash),
    euroTransfer: num(value.euroTransfer),
    orders: num(value.orders),
    altSumTransfer: num(value.altSumTransfer),
    altAmountSum: num(value.altAmountSum),
  }
}

function toParams(input: StoreReconciliationRowInput) {
  return {
    client: input.client,
    connected: input.connected ? 1 : 0,
    debtTerm: input.debtTerm,
    daysAfterPayment: input.daysAfterPayment,
    daysAfterOrder: input.daysAfterOrder,
    amountSum: input.amountSum,
    amountEuro: input.amountEuro,
    sumCash: input.sumCash,
    sumTransfer: input.sumTransfer,
    usdCash: input.usdCash,
    usdTransfer: input.usdTransfer,
    euroCash: input.euroCash,
    euroTransfer: input.euroTransfer,
    orders: input.orders,
    altSumTransfer: input.altSumTransfer,
    altAmountSum: input.altAmountSum,
  }
}

export async function listStoreReconciliationRows(): Promise<StoreReconciliationRow[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM store_reconciliation_rows ORDER BY id ASC").all()) as Row[]).map(rowToItem)
}

export async function getStoreReconciliationRow(id: number): Promise<StoreReconciliationRow | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM store_reconciliation_rows WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToItem(row) : null
}

export async function createStoreReconciliationRow(input: StoreReconciliationRowInput): Promise<StoreReconciliationRow> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO store_reconciliation_rows (
        client, connected, debt_term, days_after_payment, days_after_order, amount_sum, amount_euro,
        sum_cash, sum_transfer, usd_cash, usd_transfer, euro_cash, euro_transfer, orders, alt_sum_transfer, alt_amount_sum
      ) VALUES (
        @client, @connected, @debtTerm, @daysAfterPayment, @daysAfterOrder, @amountSum, @amountEuro,
        @sumCash, @sumTransfer, @usdCash, @usdTransfer, @euroCash, @euroTransfer, @orders, @altSumTransfer, @altAmountSum
      )`,
      )
      .run(toParams(input)))
  return (await getStoreReconciliationRow(Number(result.lastInsertRowid)))!
}

export async function updateStoreReconciliationRow(id: number, input: Partial<StoreReconciliationRowInput>): Promise<StoreReconciliationRow | null> {
  const db = getDb()
  await ensureSchema(db)
  const existing = (await getStoreReconciliationRow(id))
  if (!existing) return null
  const merged = { ...existing, ...input }
  await db.prepare(
        `UPDATE store_reconciliation_rows SET
      client = @client, connected = @connected, debt_term = @debtTerm, days_after_payment = @daysAfterPayment,
      days_after_order = @daysAfterOrder, amount_sum = @amountSum, amount_euro = @amountEuro, sum_cash = @sumCash,
      sum_transfer = @sumTransfer, usd_cash = @usdCash, usd_transfer = @usdTransfer, euro_cash = @euroCash,
      euro_transfer = @euroTransfer, orders = @orders, alt_sum_transfer = @altSumTransfer, alt_amount_sum = @altAmountSum,
      updated_at = datetime('now')
    WHERE id = @id`,
      ).run({ ...toParams(merged), id })
  return (await getStoreReconciliationRow(id))
}

export async function deleteStoreReconciliationRow(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM store_reconciliation_rows WHERE id = ?").run(id)).changes > 0
}
