// Shared types of "Работа с инвентарем" (demo #/inventory-management, API
// main/gear*): client equipment such as fridges and shelves. Client-safe (no
// server imports). Items are products marked as inventory (products.is_inventory
// = 1) with a serial and an inventory number; they sit in a warehouse or are
// attached to a client. Movements (create / give / take) are logged, agents'
// attach / detach requests are confirmed or rejected, reviews are kept.

/** Tabs of the page (demo module 2260 + the menu default "attachment"). */
export const INVENTORY_TABS = ["request", "in_stock", "in_market", "all", "history", "history_check"] as const
export type InventoryTab = (typeof INVENTORY_TABS)[number]
/** `status` URL value: a tab, or "attachment" — the menu default, which lists every item like "Все". */
export type InventoryStatusParam = InventoryTab | "attachment"
export const INVENTORY_DEFAULT_STATUS: InventoryStatusParam = "attachment"

export const INVENTORY_TAB_LABELS: Record<InventoryTab, string> = {
  request: "Запросы",
  in_stock: "На складе",
  in_market: "Прикрепление",
  all: "Все",
  history: "История движений",
  history_check: "История проверки",
}

/** Scope of the item list: in a warehouse, attached to a client, or both. */
export type InventoryItemScope = "in_stock" | "in_market" | "all"

export function scopeOfStatus(status: InventoryStatusParam): InventoryItemScope | null {
  if (status === "in_stock" || status === "in_market" || status === "all") return status
  return status === "attachment" ? "all" : null
}

/** Состояние (demo main/gear_condition). Stored as the Russian name. */
export const INVENTORY_CONDITIONS = ["Новый", "Хороший", "Средний", "Плохой", "Неисправный"] as const

export const INVENTORY_LOG_STATUSES = ["create", "give", "take"] as const
export type InventoryLogStatus = (typeof INVENTORY_LOG_STATUSES)[number]
export const INVENTORY_LOG_LABELS: Record<InventoryLogStatus, string> = { create: "Новый", give: "Передача", take: "Изъятие" }

export const INVENTORY_REQUEST_TYPES = ["attach", "detach"] as const
export type InventoryRequestType = (typeof INVENTORY_REQUEST_TYPES)[number]
export const INVENTORY_REQUEST_TYPE_LABELS: Record<InventoryRequestType, string> = { attach: "Прикрепления", detach: "Открепления" }

export const INVENTORY_REQUEST_STATUSES = ["pending", "confirmed", "canceled"] as const
export type InventoryRequestStatus = (typeof INVENTORY_REQUEST_STATUSES)[number]
export const INVENTORY_REQUEST_STATUS_LABELS: Record<InventoryRequestStatus, string> = {
  pending: "В процессе",
  confirmed: "Подтверждено",
  canceled: "Отклонено",
}

export type InventoryRef = { id: number | null; name: string }

export type InventoryItem = {
  id: number
  serialNumber: string
  /** Инвентарный номер (demo stock_number). */
  stockNumber: string
  product: { id: number | null; name: string; unit: string; organization: string }
  /** Current client, null while the item is in a warehouse. */
  client: InventoryRef | null
  warehouse: string
  condition: string
  /** Ответственный (staff member / user name). */
  responsible: string
  /** Дата (прикрепления): YYYY-MM-DD of the last movement. */
  date: string
  /** Local "YYYY-MM-DDTHH:mm:ss". */
  createdAt: string
  createdBy: string
  comment: string
  /** Одобрено (demo is_reviewed). */
  isReviewed: boolean
  reviewedAt: string
  reviewedBy: string
  hasPhoto: boolean
  /** Changes whenever the item changes (photo URL cache key). */
  version: string
  deleted: boolean
}

export type InventoryItemDetail = InventoryItem & { pendingRequests: number }

export type InventoryItemListResult = { count: number; page: number; pageSize: number; results: InventoryItem[] }

/** GET /api/inventory-items/totals (demo total_reviews). */
export type InventoryTotals = { reviewed: number; notReviewed: number; total: number }

/** Short item reference of the history / review / request rows. */
export type InventoryItemRef = { id: number; product: string; serialNumber: string; stockNumber: string; deleted: boolean; hasPhoto: boolean; version: string }

/** "История движений" row (demo main/gear_log). */
export type InventoryLog = {
  id: number
  item: InventoryItemRef
  status: InventoryLogStatus
  client: InventoryRef | null
  warehouse: string
  condition: string
  /** Дата движения, YYYY-MM-DD. */
  date: string
  comment: string
  createdBy: string
  createdAt: string
}

/** "История проверки" row (demo main/gear_check): one review of an item. */
export type InventoryCheck = {
  id: number
  item: InventoryItemRef
  client: InventoryRef | null
  isReviewed: boolean
  comment: string
  createdBy: string
  createdAt: string
}

/** "Запросы" row (demo main/gear_request). */
export type InventoryRequest = {
  id: number
  type: InventoryRequestType
  status: InventoryRequestStatus
  client: InventoryRef | null
  /** Тип инвентаря asked for (attach) or of the item (detach). */
  product: InventoryRef | null
  item: InventoryItemRef | null
  comment: string
  reason: string
  requestedBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export type InventoryListResult<T> = { count: number; page: number; pageSize: number; results: T[] }

/** GET /api/inventory-items/options — lookups of the filter popup and the dialogs. */
export type InventoryOptions = {
  products: Array<{ id: number; name: string; unit: string; organization: string }>
  warehouses: Array<{ name: string; branch: string }>
  conditions: string[]
  /** Ответственный: staff and system users. */
  responsibles: string[]
  /** Every user name seen on the module (Пользователи / Создал / Запросил / Обработал). */
  users: string[]
  zones: string[]
  agents: string[]
  organizations: string[]
  branches: string[]
  clientTypes: string[]
}

/** GET /api/inventory-items/products?warehouse= — inventory products with the warehouse balance. */
export type InventoryProductOption = { id: number; name: string; unit: string; balance: number; available: number }

/** Body of POST /api/inventory-items and PUT /api/inventory-items/[id]. */
export type InventoryItemInput = {
  warehouse: string
  productId: number
  condition: string
  responsible: string
  /** Only on create; edits keep the client (use "Передача / Изъятие"). */
  clientId?: number | null
  serialNumber: string
  stockNumber: string
  date: string
  comment: string
  /** data:image/… URL; "" removes the photo, undefined keeps it. */
  photo?: string
}

/** Body of POST /api/inventory-items/[id]/change (demo change_market). */
export type InventoryChangeInput = {
  takeDate?: string
  giveClientId?: number | null
  giveDate?: string
  condition?: string
  comment?: string
}

/** Row of POST /api/inventory-items/import (one filled template line). */
export type InventoryImportRow = {
  line: number
  clientId?: string
  client?: string
  product: string
  serialNumber?: string
  stockNumber?: string
  warehouse?: string
  condition?: string
  date?: string
  comment?: string
}

/** GET /api/inventory-items/import/template — clients of the chosen agents / zones. */
export type InventoryTemplateClient = { id: number; name: string; zone: string; agent: string }
