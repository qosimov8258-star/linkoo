// Shared (client + server) shapes of "Склады" (demo #/stock, API stock/stock/).
// Storage rules (unique names, rename cascade, delete refused while referenced,
// inactive warehouses hidden from the pickers) are in lib/warehouses-repo.ts.

export const WAREHOUSES_API = "/api/warehouses"

/** Demo StockTypeSearchField options (stock_type). */
export type WarehouseStockType = "basic" | "manufacturing"

export const WAREHOUSE_STOCK_TYPES: ReadonlyArray<{ value: WarehouseStockType; label: string }> = [
  { value: "basic", label: "Основной" },
  { value: "manufacturing", label: "Производственный" },
]

export function warehouseStockTypeLabel(value: string): string {
  return WAREHOUSE_STOCK_TYPES.find((item) => item.value === value)?.label ?? ""
}

/**
 * Element of the plain GET /api/warehouses array used by every warehouse picker
 * (unchanged contract; `online` = Вэнсел). Only active warehouses unless asked
 * with ?active=all / ?active=false.
 */
export type Warehouse = {
  id: number
  name: string
  address: string
  branch: string
  manager: string
  createdDate: string
  online: boolean
  active: boolean
}

/** Full row: paged list, GET /api/warehouses/[id], POST / PUT responses (demo stock/stock/ item). */
export type WarehouseDetail = Warehouse & {
  fullName: string
  stockType: WarehouseStockType
  /** employees.id of "Зав. склад" (null = legacy name only or none). */
  managerId: number | null
  lat: number | null
  lon: number | null
  forReturn: boolean
  trackMinAmount: boolean
  comment: string
  /** Local (Asia/Tashkent) ISO date-time of creation; '' when unknown. */
  createdAt: string
}

/** Where a warehouse is referenced (label = Russian i18n key of the section). */
export type WarehouseUsage = { table: string; label: string; count: number }

export type WarehouseDetailWithUsage = WarehouseDetail & { usage?: WarehouseUsage[] }

/** GET /api/warehouses?paged=1 (demo {count, results}). */
export type WarehouseListResult = { count: number; results: WarehouseDetail[] }

/** Header sorting of the grid (demo ordering, snake-cased). */
export const WAREHOUSE_ORDERINGS = ["name", "address", "manager", "branch", "stock_type", "is_van_sell", "created_date", "id"] as const
export type WarehouseOrderingField = (typeof WAREHOUSE_ORDERINGS)[number]
export type WarehouseOrdering = "" | WarehouseOrderingField | `-${WarehouseOrderingField}`

/** Body of POST / PUT /api/warehouses (PUT: omitted fields keep their value). */
export type WarehousePayload = {
  name: string
  fullName?: string
  address?: string
  branchId?: number | null
  /** Branch name (old callers); "" = none. */
  branch?: string
  managerId?: number | null
  /** Employee name (old callers); "" = none. */
  manager?: string
  stockType?: WarehouseStockType
  online?: boolean
  forReturn?: boolean
  trackMinAmount?: boolean
  active?: boolean
  comment?: string
  lat?: number | null
  lon?: number | null
}

export type WarehouseField = "name" | "fullName" | "address" | "branch" | "manager" | "stockType" | "comment" | "location"

/** Error body of the warehouse endpoints (`fields` = inline errors of the dialog). */
export type WarehouseErrorBody = {
  error?: string
  fields?: Partial<Record<string, string>>
  usage?: WarehouseUsage[]
  details?: { fieldErrors?: Record<string, string[] | undefined> }
}

/** Same normalisation as SQL fin_key() / lib/finance/entities.ts nameKey(). */
export function warehouseNameKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** OpenStreetMap link of a point (the "open on the map" link of the dialog). */
export function warehouseMapUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`
}
