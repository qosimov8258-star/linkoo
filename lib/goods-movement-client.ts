// Client-safe helpers that build a real "goods movement" ledger out of the
// data sources that actually exist in the backend:
//  - supplier incomings (accepted ones)  -> "in" events   (/api/supplier-incomings)
//  - write-offs                          -> "out" events  (/api/write-offs)
//  - warehouse reconciliation records    -> generic events (/api/inventory-records)
//  - internal transfers                  -> warehouse-to-warehouse transfer rows (/api/internal-transfers)
//
// There is no single "stock movement ledger" table in the schema, so this
// module composes one client-side from the real documents above. No fields
// are invented: every value shown comes straight from a real row.
import type { Incoming, IncomingItem } from "@/components/analytics/supplier-incomings-data"
import type { WriteOff, WriteOffItem } from "@/components/analytics/write-offs-data"
import type { Transfer } from "@/components/analytics/internal-transfers-data"

export type MovementEvent = {
  id: string
  product: string
  qty: number
  direction: "in" | "out"
  series: string
  date: string
  warehouse: string
  docLabel: string
}

export type ReceiptRowData = {
  id: number
  person: string
  type: string
  date: string
  warehouse: string
  items: { product: string; type: string; qty: string }[]
  creator: string
  comment: string
}

export type TransferRowData = {
  id: number
  requestDate: string
  warehouse: string
  type: string
  to: string
  sender: string
  transferDate: string
}

type InventoryRecordJson = {
  id: number
  warehouse: string
  author: string
  date: string
  comment: string
  status: "Подтвержденный" | "В ожидании" | "Отменен"
  amount: string
}

async function fetchJson<T>(url: string): Promise<T[]> {
  try {
    const response = await fetch(url)
    if (!response.ok) return []
    const data = await response.json()
    return Array.isArray(data) ? (data as T[]) : []
  } catch {
    return []
  }
}

/** Combined in/out movement ledger from accepted supplier incomings, write-offs,
 * and warehouse reconciliation records. Internal transfers are intentionally
 * left out of this per-line ledger (they move stock between two warehouses
 * rather than in/out of the business) — see fetchTransfers() for those. */
export async function fetchMovementEvents(): Promise<MovementEvent[]> {
  const [incomings, writeOffs, records] = await Promise.all([
    fetchJson<Incoming>("/api/supplier-incomings"),
    fetchJson<WriteOff>("/api/write-offs"),
    fetchJson<InventoryRecordJson>("/api/inventory-records"),
  ])

  const events: MovementEvent[] = []

  for (const incoming of incomings) {
    if (incoming.status !== "принят") continue
    for (const item of incoming.items as IncomingItem[]) {
      events.push({
        id: `incoming-${incoming.id}-${item.id}`,
        product: item.product,
        qty: item.qty,
        direction: "in",
        series: "-",
        date: incoming.date,
        warehouse: incoming.warehouse,
        docLabel: `Поставка ${incoming.id}`,
      })
    }
  }

  for (const writeOff of writeOffs) {
    for (const item of writeOff.items as WriteOffItem[]) {
      events.push({
        id: `writeoff-${writeOff.id}-${item.id}`,
        product: item.product,
        qty: item.qty,
        direction: "out",
        series: item.series || "-",
        date: writeOff.date,
        warehouse: writeOff.warehouse,
        docLabel: `Списание ${writeOff.id}`,
      })
    }
  }

  for (const record of records) {
    if (record.status === "Отменен") continue
    const amount = Number.parseFloat(record.amount)
    if (!Number.isFinite(amount) || amount === 0) continue
    events.push({
      id: `reconciliation-${record.id}`,
      product: "Инвентаризация склада",
      qty: Math.abs(amount),
      direction: amount >= 0 ? "in" : "out",
      series: "-",
      date: record.date,
      warehouse: record.warehouse,
      docLabel: `Партия ${record.id}`,
    })
  }

  return events
}

/** Supplier incomings split into "awaiting acceptance" and "already accepted",
 * matching the Приемка / История Приемки tabs. */
export async function fetchReceipts(): Promise<{ pending: ReceiptRowData[]; history: ReceiptRowData[] }> {
  const incomings = await fetchJson<Incoming>("/api/supplier-incomings")
  const toRow = (incoming: Incoming): ReceiptRowData => ({
    id: incoming.id,
    person: incoming.supplier,
    type: "Поставка",
    date: incoming.date,
    warehouse: incoming.warehouse,
    items: incoming.items.map((item) => ({ product: item.product, type: "-", qty: `${item.qty} шт.` })),
    creator: incoming.initiator,
    comment: incoming.comment,
  })
  return {
    pending: incomings.filter((incoming) => incoming.status === "ожидает").map(toRow),
    history: incomings.filter((incoming) => incoming.status === "принят").map(toRow),
  }
}

/** Internal transfers split into "принят" (in progress) and "потвержден" (delivered/history).
 * "отменен" transfers are excluded from both lists, matching how cancelled
 * documents are treated elsewhere in this ledger. */
export async function fetchTransfers(): Promise<{ pending: TransferRowData[]; history: TransferRowData[] }> {
  const transfers = await fetchJson<Transfer>("/api/internal-transfers")
  const toRow = (transfer: Transfer): TransferRowData => ({
    id: transfer.id,
    requestDate: transfer.createdAt,
    warehouse: transfer.fromWarehouse,
    type: transfer.organization || "Перемещение",
    to: transfer.toWarehouse,
    sender: transfer.driver || transfer.createdBy,
    transferDate: transfer.deliveredAt,
  })
  return {
    pending: transfers.filter((transfer) => transfer.status === "принят").map(toRow),
    history: transfers.filter((transfer) => transfer.status === "потвержден").map(toRow),
  }
}
