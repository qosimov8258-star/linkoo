import "server-only"

import { getDb } from "@/lib/db"
import type { Transfer, TransferItem } from "@/components/analytics/internal-transfers-data"

type TransferRow = {
  id: number
  from_warehouse: string
  to_warehouse: string
  created_by: string
  created_at_label: string
  delivered_at: string
  amount: number
  weight: number
  status: string
  price_list: string
  organization: string
  invoice_number: string
  transport_number: string
  driver: string
  comment: string
  items: string
}

function rowToTransfer(row: TransferRow): Transfer {
  return {
    id: row.id,
    fromWarehouse: row.from_warehouse,
    toWarehouse: row.to_warehouse,
    createdBy: row.created_by,
    createdAt: row.created_at_label,
    deliveredAt: row.delivered_at,
    amount: row.amount,
    weight: row.weight,
    status: row.status as Transfer["status"],
    priceList: row.price_list,
    organization: row.organization,
    invoiceNumber: row.invoice_number,
    transportNumber: row.transport_number,
    driver: row.driver,
    comment: row.comment,
    items: JSON.parse(row.items) as TransferItem[],
  }
}

export type TransferInput = {
  fromWarehouse: string
  toWarehouse: string
  createdAt: string
  deliveredAt: string
  priceList: string
  organization: string
  invoiceNumber: string
  transportNumber: string
  driver: string
  comment: string
  status: Transfer["status"]
  items: TransferItem[]
}

function amountOf(input: TransferInput) {
  return input.items.reduce((sum, item) => sum + item.quantity * item.price, 0)
}

export async function listTransfers(): Promise<Transfer[]> {
  const db = getDb()
  return ((await db.prepare("SELECT * FROM internal_transfers ORDER BY id DESC").all()) as TransferRow[]).map(rowToTransfer)
}

export async function getTransfer(id: number): Promise<Transfer | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM internal_transfers WHERE id = ?").get(id)) as TransferRow | undefined
  return row ? rowToTransfer(row) : null
}

export async function createTransfer(input: TransferInput): Promise<Transfer> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO internal_transfers (
        from_warehouse, to_warehouse, created_by, created_at_label, delivered_at, amount, weight,
        status, price_list, organization, invoice_number, transport_number, driver, comment, items, updated_at
      ) VALUES (
        @fromWarehouse, @toWarehouse, 'Admin Ritm', @createdAt, @deliveredAt, @amount, 0,
        @status, @priceList, @organization, @invoiceNumber, @transportNumber, @driver, @comment, @items, datetime('now')
      )`,
      )
      .run({
        fromWarehouse: input.fromWarehouse,
        toWarehouse: input.toWarehouse,
        createdAt: input.createdAt,
        deliveredAt: input.deliveredAt,
        amount: amountOf(input),
        status: input.status,
        priceList: input.priceList,
        organization: input.organization,
        invoiceNumber: input.invoiceNumber,
        transportNumber: input.transportNumber,
        driver: input.driver,
        comment: input.comment,
        items: JSON.stringify(input.items),
      }))
  return (await getTransfer(Number(result.lastInsertRowid)))!
}

export async function updateTransfer(id: number, input: TransferInput): Promise<Transfer | null> {
  const db = getDb()
  if (!(await getTransfer(id))) return null
  await db.prepare(
        `UPDATE internal_transfers SET
       from_warehouse = @fromWarehouse, to_warehouse = @toWarehouse, delivered_at = @deliveredAt,
       amount = @amount, status = @status, price_list = @priceList, organization = @organization,
       invoice_number = @invoiceNumber, transport_number = @transportNumber, driver = @driver,
       comment = @comment, items = @items, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        fromWarehouse: input.fromWarehouse,
        toWarehouse: input.toWarehouse,
        deliveredAt: input.deliveredAt,
        amount: amountOf(input),
        status: input.status,
        priceList: input.priceList,
        organization: input.organization,
        invoiceNumber: input.invoiceNumber,
        transportNumber: input.transportNumber,
        driver: input.driver,
        comment: input.comment,
        items: JSON.stringify(input.items),
      })
  return (await getTransfer(id))
}

export async function deleteTransfer(id: number): Promise<boolean> {
  const db = getDb()
  return (await db.prepare("DELETE FROM internal_transfers WHERE id = ?").run(id)).changes > 0
}
