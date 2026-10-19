import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import type { CatalogListQuery } from "@/lib/products-catalog"
import { CATALOG_ORDERINGS, EMPTY_CATALOG_FILTERS, cleanText, leadingNumber, type CatalogBoxSize, type CatalogKind, type CatalogPrice, type CatalogTab } from "@/lib/products-types"
import { CatalogError, type CatalogPatch } from "@/lib/products-write"

// Request schemas and parsers of /api/products/** and /api/raw-materials/**.
// The item body accepts the new field names and the old payload of the previous forms /
// price formation (barcode text, group, subUnit, onlyMml, groupOnly, mass, showAsInventory,
// "0 шт." / "No brand" texts, …); price_min / price_max / price_updated_date / cost /
// deleted / hasPhoto are never taken from a body (derived or owned by other flows).

const MAX_INT = 2_147_483_647

export function parseCatalogId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 && id <= MAX_INT ? id : null
}

const text = (max: number) => z.string().max(max, `Не более ${max} символов`)
/** Number or numeric text ("0 шт.", "1,5") → finite number ≥ 0. */
const amount = z
  .union([z.number(), z.string().max(64)])
  .transform((value) => leadingNumber(value))
  .refine((value) => Number.isFinite(value) && value >= 0 && value < 1e15, "Некорректное число")
const days = z.union([z.number(), z.string().max(16), z.null()]).transform((value, ctx) => {
  if (value === null || value === "") return null
  const parsed = Math.trunc(leadingNumber(value))
  if (parsed < 0 || parsed > 100_000) {
    ctx.addIssue({ code: "custom", message: "Некорректное число" })
    return z.NEVER
  }
  return parsed
})
const price = z.number().finite().min(0).max(1e15)

const priceEntrySchema = z.object({
  name: text(255),
  cash: price.optional(),
  nonCash: price.optional(),
  min: price.optional(),
  max: price.optional(),
  currency: text(16).optional(),
  nonCashCurrency: text(16).optional(),
})

const boxSizeSchema = z.object({ unit: text(100).optional(), height: amount.optional(), width: amount.optional(), length: amount.optional() })

export const catalogItemSchema = z.object({
  name: z.string().trim().max(255, "Не более 255 символов").optional(),
  fullName: text(500).optional(),
  barcodes: z.array(text(64)).max(50).optional(),
  barcode: text(2000).optional(),
  article: text(100).optional(),
  code: text(100).optional(),
  integrationCode: text(100).optional(),
  type: text(255).optional(),
  subcategory: text(255).optional(),
  organization: text(255).optional(),
  unit: text(100).optional(),
  boxUnit: text(100).optional(),
  group: text(100).optional(),
  boxAmount: amount.optional(),
  subUnit: text(100).optional(),
  orderNumber: text(32).optional(),
  supplier: text(255).optional(),
  brand: text(255).optional(),
  color: text(100).optional(),
  description: text(5000).optional(),
  minStock: amount.optional(),
  weight: amount.optional(),
  mass: amount.optional(),
  netWeight: amount.optional(),
  volume: amount.optional(),
  ikpu: text(64).optional(),
  invoiceUnitCode: text(32).optional(),
  vat: text(32).optional(),
  canSell: z.boolean().optional(),
  isMml: z.boolean().optional(),
  onlyMml: z.boolean().optional(),
  perfectStore: z.boolean().optional(),
  isInventory: z.boolean().optional(),
  showAsInventory: z.boolean().optional(),
  sellOnlyBox: z.boolean().optional(),
  groupOnly: z.boolean().optional(),
  showInBot: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  trackSeries: z.boolean().optional(),
  expirationDays: days.optional(),
  notifyExpireDays: days.optional(),
  markedProduct: z.boolean().optional(),
  manualDiscount: z.boolean().optional(),
  hideFromAgent: z.boolean().optional(),
  limitPrice: z.boolean().optional(),
  saleMinPrice: price.optional(),
  saleMaxPrice: price.optional(),
  salePriceCurrency: text(16).optional(),
  salePoints: amount.optional(),
  boxSizes: z.array(boxSizeSchema).max(20).optional(),
  priceLists: z.array(priceEntrySchema).max(500).optional(),
})

export type CatalogItemBody = z.infer<typeof catalogItemSchema>

const first = <T>(...values: Array<T | undefined>): T | undefined => values.find((value) => value !== undefined)

/** Body → patch of the editable fields (new names win over the old aliases). */
export function catalogPatch(body: CatalogItemBody): CatalogPatch {
  const patch: CatalogPatch = {}
  const set = <K extends keyof CatalogPatch>(key: K, value: CatalogPatch[K] | undefined) => {
    if (value !== undefined) patch[key] = value
  }
  set("name", body.name)
  set("fullName", body.fullName === undefined ? undefined : cleanText(body.fullName))
  set("barcodes", body.barcodes ?? (body.barcode === undefined ? undefined : body.barcode.split(/[,;\n]/).filter((code) => !/^\s*не установлен/i.test(code))))
  set("article", body.article)
  set("code", first(body.code, body.integrationCode))
  for (const key of ["type", "subcategory", "organization", "supplier", "brand", "color", "description"] as const) {
    set(key, body[key] === undefined ? undefined : cleanText(body[key]))
  }
  set("unit", body.unit === undefined ? undefined : body.unit.trim())
  const boxUnit = first(body.boxUnit, body.group)
  set("boxUnit", boxUnit === undefined ? undefined : cleanText(boxUnit))
  set("boxAmount", first(body.boxAmount, body.subUnit === undefined ? undefined : leadingNumber(body.subUnit)))
  set("orderNumber", body.orderNumber)
  set("minStock", body.minStock)
  set("weight", first(body.weight, body.mass))
  set("netWeight", body.netWeight)
  set("volume", body.volume)
  set("ikpu", body.ikpu)
  set("invoiceUnitCode", body.invoiceUnitCode)
  set("vat", body.vat)
  set("canSell", body.canSell)
  set("isMml", first(body.isMml, body.onlyMml))
  set("perfectStore", body.perfectStore)
  set("isInventory", first(body.isInventory, body.showAsInventory))
  set("sellOnlyBox", first(body.sellOnlyBox, body.groupOnly))
  set("showInBot", body.showInBot)
  set("trackExpiry", body.trackExpiry)
  set("trackSeries", body.trackSeries)
  set("expirationDays", body.expirationDays)
  set("notifyExpireDays", body.notifyExpireDays)
  set("markedProduct", body.markedProduct)
  set("manualDiscount", body.manualDiscount)
  set("hideFromAgent", body.hideFromAgent)
  set("limitPrice", body.limitPrice)
  set("saleMinPrice", body.saleMinPrice)
  set("saleMaxPrice", body.saleMaxPrice)
  set("salePriceCurrency", body.salePriceCurrency)
  set("salePoints", body.salePoints)
  set(
    "boxSizes",
    body.boxSizes?.map((size): CatalogBoxSize => ({ unit: (size.unit ?? "").trim(), height: size.height ?? 0, width: size.width ?? 0, length: size.length ?? 0 })),
  )
  set(
    "priceLists",
    body.priceLists
      ?.filter((entry) => entry.name.trim())
      .map((entry): CatalogPrice => {
        const cash = entry.cash ?? 0
        return {
          name: entry.name.trim(),
          cash,
          nonCash: entry.nonCash ?? cash,
          min: entry.min ?? 0,
          max: entry.max ?? 0,
          ...(entry.currency?.trim() ? { currency: entry.currency.trim() } : {}),
          ...(entry.nonCashCurrency?.trim() ? { nonCashCurrency: entry.nonCashCurrency.trim() } : {}),
        }
      }),
  )
  return patch
}

// --- list query ------------------------------------------------------------------------

const TABS: CatalogTab[] = ["1", "2", "3", "", "4"]

export function catalogListQuery(params: URLSearchParams, kind: CatalogKind): CatalogListQuery {
  const list = (name: string) =>
    [
      ...new Set(
        params
          .getAll(name)
          .flatMap((value) => value.split(","))
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].slice(0, 200)
  const flag = (name: string) => ["1", "true"].includes(params.get(name) ?? "")
  const status = (params.get("status") ?? "") as CatalogTab
  const tab = TABS.includes(status) && (kind === "product" || status === "" || status === "4") ? status : ""
  const ordering = params.get("ordering") ?? ""
  const page = Number(params.get("page"))
  const pageSize = Number(params.get("pageSize") ?? params.get("page_size") ?? 25)
  const canSell = params.get("canSell")
  return {
    tab,
    search: (params.get("search") ?? "").slice(0, 200),
    ordering: (CATALOG_ORDERINGS as readonly string[]).includes(ordering.replace(/^-/, "")) ? ordering : "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize >= 0 && pageSize <= 2000 ? pageSize : 25,
    filters: {
      ...EMPTY_CATALOG_FILTERS,
      typeParent: params.get("typeParent") ?? "",
      typeChild: params.get("typeChild") ?? "",
      canSell: canSell === "1" || canSell === "2" ? canSell : "",
      measurement: list("measurement"),
      brand: list("brand"),
      provider: list("provider"),
      color: list("color"),
      division: list("division"),
      supply: params.get("supply") ?? "",
      isMML: flag("isMML"),
      isGear: flag("isGear"),
      isPerfectStore: flag("isPerfectStore"),
    },
    ids: list("ids")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0 && id <= MAX_INT),
  }
}

// --- other bodies ----------------------------------------------------------------------

const ids = z.array(z.number().int().positive().max(MAX_INT)).min(1, "Выберите продукты").max(5000)

export const bulkSchema = z.object({
  ids,
  changes: z.object({
    type: text(255).optional(),
    unit: text(100).optional(),
    brand: text(255).optional(),
    organization: text(255).optional(),
    supplier: text(255).optional(),
    color: text(100).optional(),
    canSell: z.boolean().optional(),
    showInBot: z.boolean().optional(),
    isMml: z.boolean().optional(),
    manualDiscount: z.boolean().optional(),
    hideFromAgent: z.boolean().optional(),
    deleted: z.boolean().optional(),
  }),
})

export const limitsSchema = z.object({
  ids,
  agents: z.array(z.string().trim().min(1).max(255)).min(1, "Выберите агентов").max(200),
  amount: z.number().finite().min(0).max(1e12),
})

export const imageSchema = z.object({
  image: z
    .string()
    .max(8_000_000, "Файл слишком большой")
    .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/, "Неверный формат изображения"),
  isPrimary: z.boolean().optional(),
})

export const importSchema = z.object({
  mode: z.enum(["create", "update"]),
  rows: z
    .array(z.array(z.union([z.string().max(5000), z.number(), z.null()]).transform((cell) => (cell === null ? "" : String(cell)))).max(300))
    .min(1)
    .max(20_001),
})

// --- errors ----------------------------------------------------------------------------

/** JSON response of a CatalogError ({error, fields?, usage?}); null for other errors. */
export function catalogErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof CatalogError)) return null
  return NextResponse.json({ error: error.message, ...(error.fields ? { fields: error.fields } : {}), ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
}

/** Runs a write and turns a CatalogError into its JSON response. */
export async function catalogWrite(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run()
  } catch (error) {
    const response = catalogErrorResponse(error)
    if (response) return response
    throw error
  }
}
