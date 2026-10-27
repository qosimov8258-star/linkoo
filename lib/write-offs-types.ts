// Client-safe types and constants of "Списание" (demo stock/writeoff_request,
// chunk c142). Stored statuses are Russian text:
//   'ожидает' pending   no stock effect (legacy 'открыт' reads as this)
//   'закрыт'  finished  − qty at the warehouse on the write-off date
//   'отменен' cancelled no stock effect

export type WriteOffStatus = "ожидает" | "закрыт" | "отменен"

export const WRITE_OFF_STATUSES: WriteOffStatus[] = ["ожидает", "закрыт", "отменен"]

export const WRITE_OFF_STATUS_CODES: Record<WriteOffStatus, "pending" | "finished" | "cancelled"> = {
  ожидает: "pending",
  закрыт: "finished",
  отменен: "cancelled",
}

/** Demo list colours: waiting #f0ad4e, success #81c784, error #e57373. */
export const WRITE_OFF_STATUS_COLORS: Record<WriteOffStatus, string> = {
  ожидает: "#f0ad4e",
  закрыт: "#81c784",
  отменен: "#e57373",
}

export type WriteOffAction = "finish" | "cancel"

export const WRITE_OFF_ACTIONS: WriteOffAction[] = ["finish", "cancel"]

export const WRITE_OFF_TRANSITIONS: Record<WriteOffAction, { from: WriteOffStatus[]; to: WriteOffStatus }> = {
  finish: { from: ["ожидает"], to: "закрыт" },
  cancel: { from: ["ожидает", "закрыт"], to: "отменен" },
}

/** One line (write_offs.items JSON). The stock core reads product, qty and cost. */
export type WriteOffItem = {
  id: number
  key: string
  product: string
  /** Код товара (article). */
  code: string
  unit: string
  series: string
  /** Blocks (qty ÷ units per block), 0 when unknown. */
  block: number
  qty: number
  /** Себестоимость: the cost of goods when it was written off (0 for Брак). */
  cost: number
  sum: number
  /** Defective units (Брак) taken out of the warehouse's defects. */
  defect?: boolean
}

export type WriteOff = {
  id: number
  creator: string
  warehouse: string
  /** Write-off date-time (local "YYYY-MM-DDTHH:mm:ss"); the stock day. */
  date: string
  status: WriteOffStatus
  comment: string
  reason: string
  items: WriteOffItem[]
  /** Σ qty × cost. */
  total: number
  createdAt: string
  finishedAt: string
  finishedBy: string
  cancelledAt: string
  cancelledBy: string
}

export type WriteOffListResult = { count: number; page: number; pageSize: number; results: WriteOff[] }

export type WriteOffOptions = { warehouses: string[]; users: string[] }
