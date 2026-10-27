import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { parseDocInput } from "@/lib/document-dates"
import { isIsoDay } from "@/lib/finance/dates"
import { isEntryError, type EntryError } from "@/lib/net-cost-entries"
import type { NetCostListQuery } from "@/lib/net-cost-repo"
import { NET_COST_CHECK_KEYS, NET_COST_SORT_KEYS, type NetCostActionInput, type NetCostCheckKey, type NetCostEntryInput, type NetCostRecord } from "@/lib/net-cost-types"
import { parsePageParam } from "@/lib/stock/paging"
import { strictNumber } from "@/lib/strict-number"

// Request parsing of /api/cost-of-goods/** (accepts our camelCase names and the demo's
// stock/net_cost/ serializer names: product, cost, created_date, stock, begin_date,
// end_date, stock_type / stockType, only_wrong, is_correct, faults "a-b").

const text = (max: number) => z.union([z.string().max(max), z.number()]).optional()
const flag = z.union([z.boolean(), z.string(), z.number()]).optional()

export const entryBodySchema = z.object({
  item: text(200),
  product: z.union([z.string().max(200), z.number(), z.object({ value: z.union([z.string(), z.number()]).optional(), id: z.union([z.string(), z.number()]).optional() })]).optional(),
  cost: z.union([z.number(), z.string().max(60)]),
  date: text(40),
  created_date: text(40),
  createdDate: text(40),
  warehouse: text(300).nullable(),
  stock: z.union([z.string().max(300), z.number(), z.object({ name: z.string().optional(), text: z.string().optional() })]).nullable().optional(),
  comment: z.string().max(2000).optional(),
})

/** A cost: number or decimal text ("1 000,5"); anything else ("", "0x10", "12abc") = NaN (refused). */
const toNumber = (value: unknown) => {
  const parsed = strictNumber(value, { locale: true })
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export function toEntryInput(body: z.infer<typeof entryBodySchema>): NetCostEntryInput {
  const product = typeof body.product === "object" && body.product ? (body.product.value ?? body.product.id) : body.product
  const item = String(body.item ?? product ?? "").trim()
  const stock = typeof body.stock === "object" && body.stock ? (body.stock.name ?? body.stock.text ?? "") : body.stock
  // A date-time is parsed (impossible times / offsets refused), never cut to its first 10 characters;
  // an unparseable value is passed on as is, so entryDayError answers "Некорректная дата".
  const raw = String(body.date ?? body.created_date ?? body.createdDate ?? "").trim()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : raw ? (parseDocInput(raw)?.slice(0, 10) ?? raw) : ""
  return {
    item: /^\d+$/.test(item) ? `product:${item}` : item,
    cost: toNumber(body.cost),
    date,
    warehouse: String(body.warehouse ?? stock ?? "").trim(),
    comment: (body.comment ?? "").trim(),
  }
}

export const importBodySchema = z.object({ rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]).transform((value) => String(value ?? "")))).min(1).max(20_001) })

export const actionBodySchema = z.object({
  begin_date: text(40).nullable(),
  beginDate: text(40).nullable(),
  end_date: text(40).nullable(),
  endDate: text(40).nullable(),
  stock_type: z.string().max(20).nullable().optional(),
  stockType: z.string().max(20).nullable().optional(),
  stock: z.union([z.string().max(300), z.number(), z.object({ name: z.string().optional(), text: z.string().optional() })]).nullable().optional(),
  product: z.union([z.string().max(200), z.number(), z.object({ value: z.union([z.string(), z.number()]).optional(), id: z.union([z.string(), z.number()]).optional() })]).nullable().optional(),
  only_wrong: flag,
  onlyWrong: flag,
})

const truthy = (value: unknown) => value === true || value === 1 || ["1", "true", "True"].includes(String(value ?? ""))

export function toActionInput(body: z.infer<typeof actionBodySchema>): NetCostActionInput | string {
  const day = (value: unknown) => String(value ?? "").slice(0, 10)
  const beginDate = day(body.beginDate ?? body.begin_date)
  const endDate = day(body.endDate ?? body.end_date)
  if ((beginDate && !isIsoDay(beginDate)) || (endDate && !isIsoDay(endDate))) return "Некорректная дата"
  const type = String(body.stockType ?? body.stock_type ?? "all")
  const stockType = type === "common" || type === "own" ? type : "all"
  const stock = typeof body.stock === "object" && body.stock ? (body.stock.name ?? body.stock.text ?? "") : String(body.stock ?? "")
  const rawProduct = typeof body.product === "object" && body.product ? (body.product.value ?? body.product.id) : body.product
  const product = String(rawProduct ?? "").trim()
  return {
    beginDate: beginDate && endDate && beginDate > endDate ? endDate : beginDate,
    endDate: beginDate && endDate && beginDate > endDate ? beginDate : endDate,
    stockType,
    stock: stock.trim(),
    product: /^\d+$/.test(product) ? `product:${product}` : product,
    onlyWrong: truthy(body.onlyWrong ?? body.only_wrong),
  }
}

/** Query string → list query (`paged` = false for the legacy array without page params). */
export function parseListQuery(url: string): { query: NetCostListQuery; paged: boolean } {
  const params = new URL(url).searchParams
  const list = (name: string) => [...new Set(params.getAll(name).map((value) => value.trim()))]
  const day = (...names: string[]) => {
    const value = names.map((name) => params.get(name)).find(Boolean) ?? ""
    return isIsoDay(value.slice(0, 10)) ? value.slice(0, 10) : ""
  }
  const ordering = params.get("ordering") ?? ""
  const correct = (params.get("is_correct") ?? params.get("isCorrect") ?? "").toLowerCase()
  const faults = list("faults")
    .flatMap((value) => value.split("-"))
    .filter((value): value is NetCostCheckKey => (NET_COST_CHECK_KEYS as string[]).includes(value))
  const stocks = params.has("stock") ? list("stock").map((value) => (value === "__common__" ? "" : value)) : []
  const sizeText = params.get("pageSize") ?? params.get("page_size")
  const pageSize = sizeText === null || sizeText.trim() === "" ? 25 : Number(sizeText)
  return {
    paged: params.has("page") || params.has("pageSize") || params.has("page_size"),
    query: {
      search: (params.get("search") ?? "").slice(0, 200),
      products: list("product")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 500),
      stocks: [...new Set(stocks)].slice(0, 200),
      isCorrect: correct === "true" ? "true" : correct === "false" ? "false" : "",
      beginDate: day("begin_date", "beginDate", "fromDate"),
      endDate: day("end_date", "endDate", "toDate"),
      faults: [...new Set(faults)],
      ordering: (NET_COST_SORT_KEYS as readonly string[]).includes(ordering.replace(/^-/, "")) ? ordering : "",
      page: parsePageParam(params.get("page")),
      pageSize: Number.isFinite(pageSize) && pageSize >= 0 ? Math.min(Math.floor(pageSize), 100_000) : 25,
    },
  }
}

/** The pre-ledger GET shape ({name, warehouse, avgCost, cost, passed, …}), kept for old callers. */
export function legacyRow(record: NetCostRecord) {
  return {
    id: record.id,
    name: record.itemName,
    warehouse: record.stock || "Общий",
    date: record.date,
    avgCost: record.cost,
    cost: record.realCost,
    passed: record.isCorrect,
    supplyNumber: record.sourceType === "supplier_incomings" ? String(record.sourceId) : "",
    calculatedBalance: record.balance,
    actualBalance: record.balance + record.qty,
    totalRevaluation: record.totalRevaluation ?? 0,
    lastCheckTime: record.lastCheckTime,
  }
}

export function entryResponse<T extends object>(result: T | EntryError, status = 200) {
  if (isEntryError(result)) return NextResponse.json({ error: result.error, ...(result.rows ? { errors: result.rows } : {}) }, { status: result.status })
  return NextResponse.json(result, { status })
}
