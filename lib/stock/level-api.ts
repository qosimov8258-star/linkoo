import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { STOCK_LEVEL_MODES, STOCK_LEVEL_SORT_KEYS, STOCK_LEVEL_UNITS, type StockLevelQuery } from "@/lib/stock/level-types"
import { strictNum } from "@/lib/strict-number"
import { zodErrorResponse } from "@/lib/validation"

// Query string of GET /api/stock/balances(/sum|/[key]). List values are
// repeated params (?warehouse=A&warehouse=B) because names may contain commas.

const list = z.array(z.string().trim().min(1).max(300)).max(500)
const sortKeys = new Set<string>(STOCK_LEVEL_SORT_KEYS)

const querySchema = z.object({
  mode: z.enum(STOCK_LEVEL_MODES as [string, ...string[]]).default("amount"),
  unit: z.enum(STOCK_LEVEL_UNITS as [string, ...string[]]).default("amount"),
  priceList: z.string().trim().max(300).default(""),
  search: z.string().trim().max(300).default(""),
  warehouse: list,
  branch: list,
  type: list,
  subcategory: list,
  brand: list,
  supplier: list,
  organization: list,
  onlyHas: z.enum(["1", "0", "true", "false"]).optional(),
  ordering: z
    .string()
    .trim()
    .default("name")
    .refine((value) => !value || sortKeys.has(value.replace(/^-/, "")), "ordering"),
  page: strictNum(z.number().int().min(1).default(1)),
  pageSize: strictNum(z.number().int().min(0).max(5000).default(25)),
})

const LIST_KEYS = ["warehouse", "branch", "type", "subcategory", "brand", "supplier", "organization"] as const

export type ParsedStockQuery = { data: StockLevelQuery; error?: undefined } | { data?: undefined; error: NextResponse }

export function parseStockLevelQuery(url: string): ParsedStockQuery {
  const params = new URL(url).searchParams
  const raw: Record<string, unknown> = {}
  for (const [name, value] of params) {
    if ((LIST_KEYS as readonly string[]).includes(name)) {
      if (value.trim()) (raw[name] = (raw[name] as string[] | undefined) ?? []).push(value)
    } else if (value !== "") raw[name] = value
  }
  for (const name of LIST_KEYS) raw[name] ??= []
  const parsed = querySchema.safeParse(raw)
  if (!parsed.success) return { error: zodErrorResponse(parsed.error) }
  const { onlyHas, ...rest } = parsed.data
  return { data: { ...rest, onlyHas: onlyHas === "1" || onlyHas === "true" } as StockLevelQuery }
}
