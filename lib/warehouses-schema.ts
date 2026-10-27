import { z } from "zod"

import { WAREHOUSE_ORDERINGS, type WarehouseOrdering, type WarehouseStockType } from "@/components/analytics/warehouses-data"
import { strictNum } from "@/lib/strict-number"

// Request schemas of /api/warehouses. The body accepts our camelCase names, the
// demo stock/stock/ serializer names (full_name, stock_type, stock_manager,
// is_van_sell, for_return, track_min_amount, is_active, location {lat, lon}) and
// the old payload {name, address, branch, manager, online, active} so earlier
// callers (test seeds, quick-add dialogs) keep working. Messages are Russian i18n
// keys; the dialog shows them under the fields.

const REQUIRED = "Обязательное поле"
const MAX_INT = 2_147_483_647

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value)
const emptyToNull = (value: unknown) => (value === "" ? null : value)

const INVALID_ID = "Неверный идентификатор"
/** A positive integer id: a number or a digits-only string. No coercion: `true` or `[1]`
 * must not silently become id 1. */
const idSchema = z
  .union([z.number(), z.string().trim().regex(/^\d+$/, INVALID_ID).transform(Number)], { error: INVALID_ID })
  .pipe(z.number().int(INVALID_ID).positive(INVALID_ID).max(MAX_INT, INVALID_ID))
const optionalId = z.preprocess(emptyToNull, idSchema.nullable()).optional()
const optionalText = (max: number) => z.string().trim().max(max, `Не более ${max} символов`).optional()
/** A number or a numeric string (no booleans / arrays). */
const numeric = (message: string) => z.union([z.number(), z.string().trim().regex(/^-?\d+(?:[.,]\d+)?$/, message).transform((value) => Number(value.replace(",", ".")))], { error: message })
const optionalCoordinate = (limit: number) =>
  z.preprocess(emptyToNull, numeric("Неверная координата").pipe(z.number().min(-limit, "Неверная координата").max(limit, "Неверная координата")).nullable()).optional()

export const warehouseInputSchema = z.object({
  name: z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(255, "Не более 255 символов"),
  fullName: optionalText(255),
  full_name: optionalText(255),
  address: optionalText(500),
  branchId: optionalId,
  /** Branch name (old callers); "" = none. */
  branch: z.union([z.string().trim().max(255), z.number().int().positive()]).optional(),
  managerId: optionalId,
  stock_manager: optionalId,
  /** Employee name (old callers); "" = none. */
  manager: optionalText(255),
  stockType: z.enum(["basic", "manufacturing"], { error: "Неизвестный тип склада" }).optional(),
  stock_type: z.enum(["basic", "manufacturing"], { error: "Неизвестный тип склада" }).optional(),
  online: z.boolean().optional(),
  isVanSell: z.boolean().optional(),
  is_van_sell: z.boolean().optional(),
  forReturn: z.boolean().optional(),
  for_return: z.boolean().optional(),
  trackMinAmount: z.boolean().optional(),
  track_min_amount: z.boolean().optional(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  is_active: z.boolean().optional(),
  comment: z.string().trim().max(2000, "Не более 2000 символов").nullable().optional(),
  lat: optionalCoordinate(90),
  lon: optionalCoordinate(180),
  location: z
    .object({ lat: optionalCoordinate(90), lon: optionalCoordinate(180) })
    .nullable()
    .optional(),
})
export type WarehouseInputBody = z.infer<typeof warehouseInputSchema>

/** Normalised write input; `undefined` = keep the stored value (PUT) / default (POST). */
export type WarehouseInput = {
  name: string
  fullName?: string
  address?: string
  /** { id } = a branches row; { name } = a free branch name ("" = none). */
  branch?: { id: number } | { name: string }
  /** { id } = an employees row; { name } = a free employee name ("" = none). */
  manager?: { id: number } | { name: string }
  stockType?: WarehouseStockType
  online?: boolean
  forReturn?: boolean
  trackMinAmount?: boolean
  active?: boolean
  comment?: string
  /** null = no location; undefined = keep. */
  location?: { lat: number; lon: number } | null
}

export type WarehouseInputResult = { input: WarehouseInput } | { fields: Record<string, string> }

export function warehouseInput(body: WarehouseInputBody): WarehouseInputResult {
  const fields: Record<string, string> = {}
  const pick = <T,>(...values: Array<T | undefined>): T | undefined => values.find((value) => value !== undefined)

  let branch: WarehouseInput["branch"]
  if (body.branchId !== undefined) branch = body.branchId === null ? { name: "" } : { id: body.branchId }
  else if (typeof body.branch === "number") branch = { id: body.branch }
  else if (body.branch !== undefined) branch = { name: body.branch }

  let manager: WarehouseInput["manager"]
  const managerId = pick(body.managerId, body.stock_manager)
  if (managerId !== undefined) manager = managerId === null ? { name: "" } : { id: managerId }
  else if (body.manager !== undefined) manager = { name: body.manager }

  let location: WarehouseInput["location"]
  const lat = body.location === null ? null : pick(body.lat, body.location?.lat)
  const lon = body.location === null ? null : pick(body.lon, body.location?.lon)
  if (lat !== undefined || lon !== undefined) {
    if (lat == null && lon == null) location = null
    else if (lat == null || lon == null) fields.location = "Укажите широту и долготу"
    else location = { lat, lon }
  }

  if (Object.keys(fields).length) return { fields }
  return {
    input: {
      name: body.name,
      fullName: pick(body.fullName, body.full_name),
      address: body.address,
      branch,
      manager,
      stockType: pick(body.stockType, body.stock_type),
      online: pick(body.online, body.isVanSell, body.is_van_sell),
      forReturn: pick(body.forReturn, body.for_return),
      trackMinAmount: pick(body.trackMinAmount, body.track_min_amount),
      active: pick(body.active, body.isActive, body.is_active),
      comment: body.comment === null ? "" : body.comment,
      location,
    },
  }
}

// ---------------------------------------------------------------------------
// List queries
// ---------------------------------------------------------------------------

/** "true" (default) | "false" | "all". */
export type WarehouseActiveFilter = "true" | "false" | "all"

export function activeFilterOf(value: string | null | undefined, fallback: WarehouseActiveFilter = "true"): WarehouseActiveFilter {
  const normalized = (value ?? "").trim().toLowerCase()
  if (["true", "1", "yes", "active"].includes(normalized)) return "true"
  if (["false", "0", "no", "inactive"].includes(normalized)) return "false"
  if (["all", "any", "*"].includes(normalized)) return "all"
  return fallback
}

const text = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional())
const int = (min: number, max: number) => z.preprocess(emptyToUndefined, strictNum(z.number().int().min(min).max(max).optional()))
const ORDERING_VALUES = new Set<string>(WAREHOUSE_ORDERINGS.flatMap((field) => [field, `-${field}`]))

export const warehouseListQuerySchema = z.object({
  search: text(200),
  ordering: z.preprocess(emptyToUndefined, z.string().trim().refine((value) => ORDERING_VALUES.has(value), "Неизвестная сортировка").optional()),
  stockType: z.preprocess(emptyToUndefined, z.enum(["basic", "manufacturing"]).optional()),
  page: int(1, 1_000_000),
  pageSize: int(1, 2000),
})
export type WarehouseListQuery = Omit<z.infer<typeof warehouseListQuerySchema>, "ordering"> & {
  ordering?: WarehouseOrdering
  active: WarehouseActiveFilter
}

/** Query string → object; accepts the demo names (page_size, stock_type, is_active). */
export function warehouseQueryObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of params) out[key] = value
  if (out.pageSize === undefined && out.page_size !== undefined) out.pageSize = out.page_size
  if (out.stockType === undefined && out.stock_type !== undefined) out.stockType = out.stock_type
  return out
}

/** ?active= / ?isActive= / ?is_active= of a request (default: active only). */
export function warehouseActiveParam(params: URLSearchParams): WarehouseActiveFilter {
  return activeFilterOf(params.get("active") ?? params.get("isActive") ?? params.get("is_active"))
}

/** The paged {count, results} shape only on request, so every warehouse picker keeps the plain array. */
export function wantsPagedWarehouses(params: URLSearchParams): boolean {
  return params.has("page") || params.has("pageSize") || params.has("page_size") || params.get("paged") === "1"
}

export function parseWarehouseId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 && id <= MAX_INT ? id : null
}
