// Client-safe types and constants of "Инвентаризация" (demo #/inventory,
// API stock/inventory/). Storage: stock_inventories + stock_inventory_items
// (lib/stock-inventories-schema.ts); the stock core (lib/stock) reads the
// `diff` of CONFIRMED inventories as inventory_in / inventory_out movements.

export type StockInventoryStatus = "pending" | "confirmed" | "canceled"

/** fact_date = "По факту проведения" (today, current balance);
 * custom_date = "На определенную дату" (chosen day, start or end of it). */
export type StockInventoryType = "fact_date" | "custom_date"

export const STOCK_INVENTORY_STATUSES: StockInventoryStatus[] = ["pending", "confirmed", "canceled"]
export const STOCK_INVENTORY_TYPES: StockInventoryType[] = ["fact_date", "custom_date"]

/** Demo labels (module 4749 list / 4750 detail). */
export const STOCK_INVENTORY_STATUS_LABELS: Record<StockInventoryStatus, string> = {
  pending: "В ожидании",
  confirmed: "Подтвержденный",
  canceled: "Отменен",
}

/** Demo filter labels (module 4373). */
export const STOCK_INVENTORY_STATUS_FILTER_LABELS: Record<StockInventoryStatus, string> = {
  pending: "В ожидании",
  confirmed: "Подтвержденный",
  canceled: "Отменено",
}

/** Demo status dots: success #81c784, waiting #f0ad4e, error #e57373. */
export const STOCK_INVENTORY_STATUS_COLORS: Record<StockInventoryStatus, string> = {
  pending: "#f0ad4e",
  confirmed: "#81c784",
  canceled: "#e57373",
}

export const STOCK_INVENTORY_TYPE_LABELS: Record<StockInventoryType, string> = {
  fact_date: "По факту проведения",
  custom_date: "На определенную дату",
}

/** One row of the list (demo columns № | Склад | Создал | Дата создания | Комментарий | Статус | Сумма). */
export type StockInventoryRow = {
  id: number
  warehouse: string
  type: StockInventoryType
  /** Inventory day "YYYY-MM-DD" (Asia/Tashkent). */
  invDate: string
  /** false = "На начало дня", true = "На конец дня". */
  forDayEnd: boolean
  status: StockInventoryStatus
  comment: string
  currency: string
  /** Σ diff × cost: frozen once confirmed, a snapshot of the last save while pending. */
  totalPrice: number
  createdBy: string
  /** Local "YYYY-MM-DDTHH:mm:ss" of the creation. */
  createdAt: string
  /** What the demo prints as "Дата создания": the creation moment for fact_date,
   * the chosen day for custom_date. */
  createdDate: string
  itemCount: number
}

/** One counted line (detail columns Наименование | Серия | Баланс (до) | Баланс (после) | Разница | Сумма). */
export type StockInventoryItem = {
  id: number
  /** StockItemKey: "product:12" | "raw_material:3" | "name:<key>". */
  key: string
  name: string
  article: string
  unit: string
  series: string
  /** Counted quantity = "Баланс (после)". */
  amount: number
  /** System balance = "Баланс (до)". */
  balanceAmount: number
  /** amount − balanceAmount. */
  diff: number
  /** Average unit cost at the moment (falls back to the catalog cost). */
  cost: number
  /** diff × cost. */
  totalPrice: number
  position: number
}

export type StockInventoryDetail = StockInventoryRow & {
  confirmedAt: string
  confirmedBy: string
  canceledAt: string
  canceledBy: string
  /** true while pending: balances / diffs were computed now from the stock core. */
  live: boolean
  /** Set when the live computation failed (the stored snapshot is shown instead). */
  liveError: string
  items: StockInventoryItem[]
}

export type StockInventoryListResult = { count: number; results: StockInventoryRow[] }

export type StockInventoryOrdering = "id" | "-id" | "created_date" | "-created_date" | "total_price" | "-total_price"

export type StockInventoryListQuery = {
  search: string
  status: StockInventoryStatus | ""
  warehouses: string[]
  createdBy: string[]
  fromDate: string
  toDate: string
  ordering: StockInventoryOrdering
  page: number
  /** 0 = every row (Excel). */
  pageSize: number
}

/** System balance of one item in the chosen warehouse at the chosen moment (create dialog). */
export type StockInventoryBalanceRow = {
  key: string
  name: string
  article: string
  type: string
  brand: string
  unit: string
  /** System quantity ("Остаток"). */
  qty: number
  cost: number
  defects: number
  /** false for document lines whose name matches no product / raw material. */
  inCatalog: boolean
}

export type StockInventoryBalances = {
  warehouse: string
  date: string
  forDayEnd: boolean
  rows: StockInventoryBalanceRow[]
}

/** GET /api/stock/inventories/options: warehouse select, "Создал" filter, base currency. */
export type StockInventoryOptions = {
  warehouses: string[]
  users: string[]
  currency: string
}

export type StockInventoryLineInput = { key: string; amount: number; series?: string }

/** POST /api/stock/inventories and PUT /api/stock/inventories/[id]. */
export type StockInventoryInput = {
  type: StockInventoryType
  warehouse: string
  /** Required for custom_date; fact_date always uses today. */
  invDate?: string
  forDayEnd?: boolean
  comment?: string
  items: StockInventoryLineInput[]
}

/** One row of an imported Excel file (matched by article first, then by name). */
export type StockInventoryImportRow = { name?: string; article?: string; amount: number | string | null; line?: number }

export type StockInventoryImportInput = Omit<StockInventoryInput, "items"> & { rows: StockInventoryImportRow[] }
