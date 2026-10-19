import "server-only"

import { z } from "zod"

import { PRICE_LIST_SORT_KEYS, type PriceListActive, type PriceListInput, type PriceListListQuery } from "@/lib/price-lists-repo"

// Request parsing of /api/price-lists/** (the older body {name, currency, linkedList, calcMethod}
// is still accepted).

const num = z.union([z.number(), z.string()])

const toNumber = (value: unknown): number => {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

export const priceListBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  currency: z.string().trim().max(20).optional(),
  position: num.optional().nullable(),
  isActive: z.boolean().optional(),
  isDefaultForOrder: z.boolean().optional(),
  connectedPriceListId: z.number().int().positive().nullable().optional(),
  linkedList: z.string().trim().max(200).optional(),
  calcMethodId: z.string().trim().max(50).nullable().optional(),
  /** Older body: the method NAME or id. */
  calcMethod: z.string().trim().max(200).optional(),
  methodValues: z.array(z.object({ methodKey: z.string().trim().min(1).max(50), value: num })).max(20).optional(),
})

export type PriceListBody = z.infer<typeof priceListBodySchema>

export function toPriceListInput(body: PriceListBody): PriceListInput {
  return {
    name: body.name,
    currency: body.currency || undefined,
    position: body.position === undefined || body.position === null || body.position === "" ? undefined : toNumber(body.position),
    isActive: body.isActive,
    isDefaultForOrder: body.isDefaultForOrder,
    connectedPriceListId: body.connectedPriceListId,
    linkedList: body.connectedPriceListId === undefined ? body.linkedList : undefined,
    calcMethodId: body.calcMethodId !== undefined ? body.calcMethodId : body.calcMethod === undefined ? undefined : body.calcMethod === "Не указано" ? null : body.calcMethod,
    methodValues: body.methodValues?.map((item) => ({ methodKey: item.methodKey, value: toNumber(item.value) })),
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
      page: Math.max(1, Math.floor(Number(params.get("page")) || 1)),
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

/** "" / null / undefined → undefined (keep); otherwise a number. */
export function optionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return undefined
  return toNumber(value)
}
