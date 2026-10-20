import "server-only"

import { z } from "zod"

import { PRICE_LIST_SORT_KEYS, type PriceListActive, type PriceListInput, type PriceListListQuery } from "@/lib/price-lists-repo"
import { parsePageParam } from "@/lib/stock/paging"

// Request parsing of /api/price-lists/** (the older body {name, currency, linkedList, calcMethod}
// is still accepted).

const num = z.union([z.number(), z.string().max(64)])

/** Number or numeric text ("12 500", "0,5") → number; NaN for anything else ("oʻn ming", "12 000 soʻm"). */
export const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value
  const text = String(value ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".")
  return text && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text) ? Number(text) : Number.NaN
}

const blankToUndefined = (value: unknown) => (value === null || (typeof value === "string" && !value.trim()) ? undefined : value)

/** "Порядок": a whole number (text that is not a number is a 400, never a silent 0). */
const positionSchema = z.preprocess(
  blankToUndefined,
  z
    .union([z.number(), z.string().max(32)])
    .transform((value) => toNumber(value))
    .pipe(z.number({ error: "Введите целое число" }).int("Введите целое число").min(-1_000_000, "Введите целое число").max(1_000_000, "Введите целое число"))
    .optional(),
)

/** A calculation-method value (percent, amount, rate, rounding step): a number, |x| ≤ 1e13. */
const methodValueSchema = num
  .transform((value) => toNumber(value))
  .pipe(z.number({ error: "Введите число" }).min(-1e13, "Введите число").max(1e13, "Введите число"))

export const priceListBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  currency: z.string().trim().max(20).optional(),
  position: positionSchema,
  isActive: z.boolean().optional(),
  isDefaultForOrder: z.boolean().optional(),
  connectedPriceListId: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  linkedList: z.string().trim().max(200).optional(),
  calcMethodId: z.string().trim().max(50).nullable().optional(),
  /** Older body: the method NAME or id. */
  calcMethod: z.string().trim().max(200).optional(),
  methodValues: z.array(z.object({ methodKey: z.string().trim().min(1).max(50), value: methodValueSchema })).max(20).optional(),
})

export type PriceListBody = z.infer<typeof priceListBodySchema>

export function toPriceListInput(body: PriceListBody): PriceListInput {
  return {
    name: body.name,
    currency: body.currency || undefined,
    position: body.position,
    isActive: body.isActive,
    isDefaultForOrder: body.isDefaultForOrder,
    connectedPriceListId: body.connectedPriceListId,
    linkedList: body.connectedPriceListId === undefined ? body.linkedList : undefined,
    calcMethodId: body.calcMethodId !== undefined ? body.calcMethodId : body.calcMethod === undefined ? undefined : body.calcMethod === "Не указано" ? null : body.calcMethod,
    methodValues: body.methodValues?.map((item) => ({ methodKey: item.methodKey, value: item.value })),
  }
}

/** Query → paged list query; null = plain array (no `paged` / `page` / `pageSize`). */
export function parsePriceListQuery(url: string): { paged: PriceListListQuery | null; active: PriceListActive } {
  const params = new URL(url).searchParams
  const activeParam = params.get("active") ?? params.get("isActive") ?? ""
  const active: PriceListActive = activeParam === "false" ? "false" : activeParam === "all" ? "all" : "true"
  if (!params.has("paged") && !params.has("page") && !params.has("pageSize")) return { paged: null, active }
  const ordering = params.get("ordering") ?? ""
  const pageSize = Number(params.get("pageSize") ?? 25)
  return {
    active,
    paged: {
      search: (params.get("search") ?? "").slice(0, 200),
      ordering: PRICE_LIST_SORT_KEYS.includes(ordering.replace(/^-/, "")) ? ordering : "",
      page: parsePageParam(params.get("page")),
      pageSize: Number.isFinite(pageSize) && pageSize >= 0 ? Math.min(5000, Math.floor(pageSize)) : 25,
      // The page shows every list (active and not) unless asked otherwise.
      active: activeParam ? active : "all",
    },
  }
}

export const priceGridSaveSchema = z.object({
  rows: z
    .array(
      z.object({
        kind: z.enum(["product", "raw_material"]),
        id: z.number().int().positive(),
        prices: z
          .array(
            z.object({
              priceListId: z.number().int().positive(),
              cash: num.optional().nullable(),
              nonCash: num.optional().nullable(),
              min: num.optional().nullable(),
              max: num.optional().nullable(),
            }),
          )
          .min(1)
          .max(200),
      }),
    )
    .min(1)
    .max(20000),
  cashCurrency: z.string().trim().min(1).max(20),
  nonCashCurrency: z.string().trim().max(20).optional(),
})

export type PriceGridSaveInput = z.infer<typeof priceGridSaveSchema>

/** "" / null / undefined → undefined (keep); otherwise a number — NaN when the text is not one. */
export function optionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return undefined
  return toNumber(value)
}
