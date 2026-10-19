import "server-only"

import { z } from "zod"

import { REPRICING_SORT_KEYS, type RepricingInput, type RepricingListQuery } from "@/lib/repricings-repo"
import type { RepricingStatus } from "@/components/analytics/repricing-data"

// Request parsing of /api/repricings/**.

const num = z.union([z.number(), z.string()])

const toNumber = (value: unknown): number => {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : NaN
}

export const repricingCreateSchema = z.object({
  priceListId: z.number().int().positive(),
  currency: z.string().trim().min(1).max(20),
  comment: z.string().max(2000).optional(),
  products: z
    .array(z.object({ kind: z.enum(["product", "raw_material"]), id: z.number().int().positive(), price: num }))
    .min(1)
    .max(5000),
  connected: z.boolean().optional(),
})

export type RepricingCreateBodyParsed = z.infer<typeof repricingCreateSchema>

/** Body → input; {field, error} when a price is not a number ≥ 0. */
export function toRepricingInput(body: RepricingCreateBodyParsed): RepricingInput | { error: string } {
  const products: RepricingInput["products"] = []
  for (const product of body.products) {
    const price = toNumber(product.price)
    if (!Number.isFinite(price) || price < 0) return { error: "Некорректная цена" }
    products.push({ kind: product.kind, id: product.id, price: Math.round(price * 1e6) / 1e6 })
  }
  return { priceListId: body.priceListId, currency: body.currency, comment: (body.comment ?? "").trim(), products, connected: body.connected === true }
}

export const repricingConnectedSchema = z.object({ priceListId: z.number().int().positive(), priceListName: z.string().optional() })

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
    page: Math.max(1, Math.floor(Number(params.get("page")) || 1)),
    pageSize: Number.isFinite(pageSize) && pageSize >= 0 ? Math.min(5000, Math.floor(pageSize)) : 25,
    priceLists: list("priceList").map(Number).filter((id) => Number.isInteger(id) && id > 0),
    users: list("user"),
    status: status === "finished" || status === "canceled" ? (status as RepricingStatus) : "",
    products: list("product").filter((key) => /^(product|raw_material):\d+$/.test(key)),
  }
}

export function parseRepricingId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}
