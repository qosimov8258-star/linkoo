import "server-only"

import { z } from "zod"

import { INVALID_PRICE, isValidPrice } from "@/lib/item-prices"
import { toNumber } from "@/lib/price-lists-api"
import { REPRICING_SORT_KEYS, type RepricingInput, type RepricingListQuery } from "@/lib/repricings-repo"
import { parsePageParam } from "@/lib/stock/paging"
import type { RepricingStatus } from "@/components/analytics/repricing-data"

// Request parsing of /api/repricings/**.

const num = z.union([z.number(), z.string().max(64)])

const MAX_ID = 2_147_483_647

export const repricingCreateSchema = z.object({
  priceListId: z.number().int().positive().max(MAX_ID),
  currency: z.string().trim().min(1).max(20),
  comment: z.string().max(2000).optional(),
  products: z
    .array(z.object({ kind: z.enum(["product", "raw_material"]), id: z.number().int().positive().max(MAX_ID), price: num }))
    .min(1)
    .max(5000),
  connected: z.boolean().optional(),
})

export type RepricingCreateBodyParsed = z.infer<typeof repricingCreateSchema>

/** Body → input; {error} when a price is not a number with 0 ≤ x ≤ MAX_PRICE (1e13). */
export function toRepricingInput(body: RepricingCreateBodyParsed): RepricingInput | { error: string } {
  const products: RepricingInput["products"] = []
  for (const product of body.products) {
    const price = toNumber(product.price)
    if (!isValidPrice(price)) return { error: INVALID_PRICE }
    products.push({ kind: product.kind, id: product.id, price: Math.round(price * 1e6) / 1e6 })
  }
  return { priceListId: body.priceListId, currency: body.currency, comment: (body.comment ?? "").trim(), products, connected: body.connected === true }
}

export const repricingConnectedSchema = z.object({ priceListId: z.number().int().positive().max(MAX_ID), priceListName: z.string().optional() })

/** Query → list query; null = the plain array (no paging params). */
export function parseRepricingListQuery(url: string): RepricingListQuery | null {
  const params = new URL(url).searchParams
  if (!params.has("paged") && !params.has("page") && !params.has("pageSize")) return null
  const list = (name: string) => [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))].slice(0, 200)
  const ordering = params.get("ordering") ?? ""
  const pageSize = Number(params.get("pageSize") ?? 25)
  const status = params.get("status") ?? ""
  return {
    search: (params.get("search") ?? "").slice(0, 200),
    ordering: REPRICING_SORT_KEYS.includes(ordering.replace(/^-/, "")) ? ordering : "",
    page: parsePageParam(params.get("page")),
    pageSize: Number.isFinite(pageSize) && pageSize >= 0 ? Math.min(5000, Math.floor(pageSize)) : 25,
    priceLists: list("priceList").map(Number).filter((id) => Number.isInteger(id) && id > 0 && id <= MAX_ID),
    users: list("user"),
    status: status === "finished" || status === "canceled" ? (status as RepricingStatus) : "",
    products: list("product").filter((key) => /^(product|raw_material):\d+$/.test(key)),
  }
}

/** Route param → positive int4 id (non-numeric / too large → null → 404, never a 500). */
export function parseRepricingId(value: string): number | null {
  const id = Number(value)
  return /^\d+$/.test(value.trim()) && Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null
}
