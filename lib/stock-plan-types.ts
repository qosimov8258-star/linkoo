import type { StockMoveKind } from "@/lib/stock/types"

// "План приемок и передач" (demo #/stock/receive …, chunks c88 / c89 / c90):
// shared (client-safe) types and labels of /api/stock/plan/**.
//   receive          Приемка          — supplies 'ожидает' + transfers 'в пути' to the warehouse + client returns 'pending'
//   transfer         Передача         — transfers 'потвержден' from the warehouse + orders 'Есть на складе' with a warehouse
//   movement         Движение товаров — every line of the stock ledger (lib/stock stockMovementsSql)
//   receive_history  История Приемки  — accepted supplies, transfers and client returns
//   transfer_history История Передачи — given transfers and shipped orders

export const PLAN_TABS = ["receive", "transfer", "movement", "receive_history", "transfer_history"] as const
export type PlanTab = (typeof PLAN_TABS)[number]
export type PlanTaskTab = Exclude<PlanTab, "movement">
export const PLAN_TASK_TABS: PlanTaskTab[] = ["receive", "transfer", "receive_history", "transfer_history"]

export const PLAN_TAB_LABELS: Record<PlanTab, string> = {
  receive: "Приемка",
  transfer: "Передача",
  movement: "Движение товаров",
  receive_history: "История Приемки",
  transfer_history: "История Передачи",
}

/** Task kinds (demo income_tasks / outcome_tasks `type`). */
export type PlanTaskType = "supply" | "transfer" | "order_return" | "order"

export const PLAN_TYPE_LABELS: Record<PlanTaskType, string> = {
  supply: "Поставка",
  transfer: "Передача",
  order_return: "Возврат",
  order: "Заказ",
}

/** Types offered by the "Тип" filter of each task tab (demo StockReceiveTypeSearchFiled / OrderTransferTypeSearchField). */
export const PLAN_TAB_TYPES: Record<PlanTaskTab, PlanTaskType[]> = {
  receive: ["supply", "transfer", "order_return"],
  receive_history: ["supply", "transfer", "order_return"],
  transfer: ["order", "transfer"],
  transfer_history: ["order", "transfer"],
}

export const isReceiveTab = (tab: PlanTaskTab) => tab === "receive" || tab === "receive_history"
export const isHistoryTab = (tab: PlanTaskTab) => tab === "receive_history" || tab === "transfer_history"

/** Permissions (lib/capabilities-catalog.ts) the plan's row actions need: supplies
 * go to /api/supplier-incomings (procurement.manage); transfers and client returns
 * to /api/internal-transfers and /api/stock/plan/returns (stock.manage). */
export type PlanPermission = "stock.manage" | "procurement.manage"
/** What the signed-in user may do on the plan (role manager / admin and, for a user
 * restricted by an access right, the permission granted). All false while loading. */
export type PlanRights = Record<PlanPermission, boolean>
export const NO_PLAN_RIGHTS: PlanRights = { "stock.manage": false, "procurement.manage": false }

/** One row of a task tab. Dates are local "YYYY-MM-DDTHH:mm:ss" ("" = unknown). */
export type PlanTaskRow = {
  type: PlanTaskType
  id: number
  /** От кого (receive tabs: supplier / source warehouse) or Кому (transfer tabs: target warehouse / client). */
  party: string
  /** The warehouse doing the work: receiving (receive tabs) or sending (transfer tabs). */
  warehouse: string
  /** Дата запроса: when the document was created / ordered. */
  requestDate: string
  /** The tab's date column: Дата приемки (expected or done) / Дата передачи (planned or done). */
  date: string
  /** Доставщик: transfer driver / order delivery man. */
  deliverer: string
  /** Принял / Передал ("" while pending). */
  doneBy: string
  doneAt: string
  /** Stored document status (Russian text). */
  status: string
}

export type PlanTaskCounts = Record<PlanTaskTab, number>

export type PlanTaskListResult = {
  tab: PlanTaskTab
  count: number
  page: number
  pageSize: number
  results: PlanTaskRow[]
  /** Distinct Принял / Передал names of the history tab (filter options). */
  doneByOptions: string[]
}

export type PlanItemProduct = {
  key: string
  name: string
  /** Тип товара (catalog product type). */
  productType: string
  qty: number
  unit: string
}

export type PlanItemDetail = {
  type: PlanTaskType
  id: number
  status: string
  /** Supplier / source warehouse (receive) or client / target warehouse (send). */
  fromName: string
  toName: string
  createdBy: string
  createdAt: string
  /** Planned date: supply date, transfer "Дата доставки", order delivery date. */
  plannedDate: string
  deliverer: string
  givenBy: string
  givenAt: string
  acceptedBy: string
  acceptedAt: string
  comment: string
  products: PlanItemProduct[]
}

// --- Движение товаров ---------------------------------------------------------------------

/** "Тип" of a movement line (demo getStockReceivesType labels) and the ledger kinds behind it. */
export const PLAN_MOVE_TYPES: Array<{ id: string; label: string; kinds: StockMoveKind[] }> = [
  { id: "supply", label: "Поставка", kinds: ["supply"] },
  { id: "supply_return", label: "Возврат с П.", kinds: ["supply_return"] },
  { id: "order", label: "Заказ", kinds: ["order"] },
  { id: "return", label: "Возврат", kinds: ["return"] },
  { id: "writeoff", label: "Списание", kinds: ["writeoff"] },
  { id: "transfer", label: "Передача", kinds: ["transfer_in", "transfer_out"] },
  { id: "manufacture_in", label: "Произведено", kinds: ["manufacture_in"] },
  { id: "manufacture_out", label: "Затрачено на производство", kinds: ["manufacture_out"] },
  { id: "none", label: "Партия", kinds: ["none_in", "none_out"] },
  { id: "inventory", label: "Инвентаризация", kinds: ["inventory_in", "inventory_out"] },
  // Filter-only entries: the reference filter lists the two transfer directions separately.
  { id: "transfer_in", label: "Передача", kinds: ["transfer_in"] },
  { id: "transfer_out", label: "Передача", kinds: ["transfer_out"] },
]

/** Options of the "Тип" select in the "Движение товаров" filter (reference order and wording). */
export const PLAN_MOVE_FILTER_TYPES: Array<{ id: string; label: string }> = [
  { id: "order", label: "Заказы" },
  { id: "return", label: "Возврат" },
  { id: "supply", label: "Поставка" },
  { id: "supply_return", label: "Возврат поставки" },
  { id: "transfer_in", label: "Перемещение к складу" },
  { id: "transfer_out", label: "Перемещение с склада" },
]

/** "Статус" of the "Движение товаров" filter: the sign of the quantity. */
export const PLAN_MOVE_DIRECTIONS: Array<{ id: string; label: string }> = [
  { id: "in", label: "Приход" },
  { id: "out", label: "Расход" },
]

export function planMoveType(kind: string): { id: string; label: string } {
  const found = PLAN_MOVE_TYPES.find((type) => (type.kinds as string[]).includes(kind))
  return found ? { id: found.id, label: found.label } : { id: kind, label: kind }
}

export type PlanMovementRow = {
  /** Stable row id (doc type, doc id, item, kind, warehouse). */
  id: string
  /** Local day "YYYY-MM-DD" ("" = undated document). */
  day: string
  warehouse: string
  kind: StockMoveKind
  docType: string
  docId: number
  /** № shown: the document id (production: the batch / party id). */
  docNumber: number
  key: string
  name: string
  article: string
  unit: string
  /** Signed quantity (+ in, − out). */
  qty: number
  isDefect: boolean
}

export type PlanMovementResult = { count: number; page: number; pageSize: number; results: PlanMovementRow[] }

export type PlanOptionsResult = { products: Array<{ key: string; name: string }> }

export const PLAN_PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000] as const
