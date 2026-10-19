// Client-safe types and constants of "Себестоимость" (demo stock/net_cost/, chunk c46).
//
// A cost record ("себестоимость") is created by every receipt that brings goods in at a
// known unit cost — accepted supply (incl. its expenses), production output, inventory
// surplus at cost, a transfer into a warehouse with its own cost — and by every manual
// cost entry ("Добавить себестоимость", own table net_cost_entries). The ledger keeps a
// moving average per item and scope: "Общий" (all warehouses together) or a warehouse
// that has its own manual cost entries (from the day of its first entry).

export const NET_COST_API = "/api/cost-of-goods"

/** The demo check_data keys and names (the names are i18n keys). */
export const NET_COST_CHECKS = [
  { key: "is_balance_correct", name: "Анализ баланса" },
  { key: "is_negative_balance_correct", name: "Анализ отрицательного баланса" },
  { key: "is_timelapse_correct", name: "Анализ времены" },
] as const

export type NetCostCheckKey = (typeof NET_COST_CHECKS)[number]["key"]

export const NET_COST_CHECK_KEYS: NetCostCheckKey[] = NET_COST_CHECKS.map((check) => check.key)

export type NetCostCheck = { key: NetCostCheckKey; name: string; isCorrect: boolean }

/** Document that created the record. */
export type NetCostSource = "supplier_incomings" | "production_movements" | "stock_inventories" | "internal_transfers" | "manual"

/** List sort keys (demo column names). */
export const NET_COST_SORT_KEYS = ["product__name", "stock", "created_date", "cost", "real_cost", "id"] as const

export type NetCostRecord = {
  id: number
  /** Stock item key: "product:<id>" | "raw_material:<id>" | "name:<key>". */
  itemKey: string
  itemName: string
  /** Scope of the average: '' = "Общий", else the warehouse with its own cost. */
  stock: string
  /** Warehouse of the source document ('' for a common manual entry). */
  warehouse: string
  /** Day of the record ("YYYY-MM-DD"), with the document time when known ("YYYY-MM-DDTHH:mm"). */
  date: string
  sourceType: NetCostSource
  sourceId: number
  /** Received quantity (0 for a manual entry). */
  qty: number
  /** Себестоимость: unit cost of this receipt / entry. */
  realCost: number
  /** Уср. себестоимость: moving average after this record. */
  cost: number
  /** Average before this record (null = none yet). */
  prevCost: number | null
  /** Рассчитанный баланс: scope balance just before this record. */
  balance: number
  /** Сумма переоценки = cost − prevCost (null for the first record of a scope). */
  revaluation: number | null
  /** Общая сумма переоценки = revaluation × balance. */
  totalRevaluation: number | null
  isCorrect: boolean
  checkData: NetCostCheck[]
  /** Последнее время проверки ("YYYY-MM-DDTHH:mm:ss", local). */
  lastCheckTime: string
  isManual: boolean
  entryId: number | null
}

export type NetCostListResult = { count: number; page: number; pageSize: number; results: NetCostRecord[]; currency: string }

/** One row of the header table (demo stock/net_cost/total/). */
export type NetCostTotalRow = {
  /** null = "Общий" (all warehouses together). */
  stock: string | null
  /** Накопленная себестоимость: value accumulated through the documents at ledger costs. */
  cumulativeCost: number
  /** Текущая себестоимость остатки: current balance × current average. */
  lastCost: number
  /** Разница = lastCost − cumulativeCost. */
  fault: number
  /** Сумма переоценки of the stock on hand (Σ revaluation × balance). */
  totalRevaluation: number
  isCorrect: boolean
  /** Items with stock but no cost. */
  noCostProductCount: number
}

export type NetCostTotals = { currency: string; rows: NetCostTotalRow[]; builtAt: string }

/** A document of a cost record: its source and the movements valued at its average. */
export type NetCostDocument = {
  docType: string
  docId: number
  /** Stock movement kind (StockMoveKind) or "manual". */
  kind: string
  warehouse: string
  day: string
  /** Signed quantity. */
  qty: number
  /** Unit cost the movement was valued at. */
  cost: number
  /** Scope balance after the movement. */
  balanceAfter: number
}

export type NetCostDetail = NetCostRecord & {
  balanceAfter: number
  /** Day of the next record of the same item and scope (the end of this record's period). */
  nextDate: string | null
  comment: string
  documents: NetCostDocument[]
  /** Movements that left the balance negative while this record was in effect. */
  negativeTransactions: NetCostDocument[]
}

export type NetCostItemOption = { key: string; name: string; kind: "product" | "raw_material" }

export type NetCostOptions = {
  items: NetCostItemOption[]
  warehouses: string[]
  currency: string
  faultTypes: Array<{ key: NetCostCheckKey; name: string }>
}

/** "Все" | "Общие склады" | "Выбранный склад". */
export type NetCostScopeType = "all" | "common" | "own"

export type NetCostEntryInput = { item: string; cost: number; date: string; warehouse: string; comment: string }

export type NetCostActionKind = "recheck" | "recalc" | "recalc-period" | "reset-period" | "regenerate"

export type NetCostActionInput = {
  beginDate: string
  endDate: string
  stockType: NetCostScopeType
  stock: string
  product: string
  onlyWrong: boolean
}

export type NetCostActionResult = { action: NetCostActionKind; affected: number; incorrect: number; records: number }

export type NetCostImportResult = { created: number; updated: number }

/** Labels of the source documents (i18n keys). */
export const NET_COST_SOURCE_LABELS: Record<string, string> = {
  supplier_incomings: "Поставка",
  production_movements: "Производство",
  stock_inventories: "Инвентаризация",
  internal_transfers: "Передача на склад",
  supplier_returns: "Возврат поставщику",
  write_offs: "Списание",
  orders: "Заказ",
  manual: "Произвольная себестоимость",
}

/** Pages that open a document by `?id=`. */
export const NET_COST_DOC_LINKS: Record<string, string> = {
  write_offs: "/analytics/write-offs",
  internal_transfers: "/analytics/internal-transfers",
  stock_inventories: "/analytics/inventory",
}
