import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { dbErrorResponse } from "@/lib/db-errors"
import { MAX_PAGE } from "@/lib/stock/paging"
import { cleanJsonText, invalidFieldResponse, NOT_JSON_MESSAGE, parseIdSegment, zodErrorResponse } from "@/lib/validation"
import {
  STOCK_INVENTORY_STATUSES,
  type StockInventoryListQuery,
  type StockInventoryOrdering,
  type StockInventoryStatus,
} from "@/lib/stock-inventories-types"
import { strictNumber } from "@/lib/strict-number"

// HTTP helpers of /api/stock/inventories/** (route files export only handlers).
// Error messages are Russian i18n keys; the UI shows them through t().

export class StockInventoryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** JSON response of a StockInventoryError ({error, field?, …extra}); rethrows anything else. */
export function stockInventoryErrorResponse(error: unknown): NextResponse {
  if (error instanceof StockInventoryError) {
    return NextResponse.json({ error: error.message, field: error.field ?? null, ...(error.extra ?? {}) }, { status: error.status })
  }
  const busy = dbErrorResponse(error)
  if (busy) return busy
  throw error
}

export type Parsed<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

function bad(name: string, hint: string) {
  return invalidFieldResponse(name, hint)
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ORDERINGS: StockInventoryOrdering[] = ["id", "-id", "created_date", "-created_date", "total_price", "-total_price"]

export function parseInventoryId(value: string): number | null {
  // Canonical digits only ("0x10" / "1e1" never resolve to another record).
  return parseIdSegment(value)
}

function texts(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => value.split("~")).map((value) => value.trim()).filter(Boolean))]
}

/**
 * GET /api/stock/inventories?search &status=pending|confirmed|canceled &warehouse=<name>* (also stock)
 * &createdBy=<name>* (also created_by) &fromDate &toDate (also begin_date / end_date; inventory day)
 * &ordering=id|-id|created_date|-created_date|total_price|-total_price &page &pageSize (0 = all; also page_size)
 */
export function parseInventoryListQuery(url: string): Parsed<StockInventoryListQuery> {
  const search = new URL(url).searchParams
  const status = (search.get("status") ?? "").trim()
  if (status && !STOCK_INVENTORY_STATUSES.includes(status as StockInventoryStatus)) return { error: bad("status", STOCK_INVENTORY_STATUSES.join(" | ")) }
  const rawPage = Number(search.get("page") ?? 1)
  const pageSize = Number(search.get("pageSize") ?? search.get("page_size") ?? 25)
  if (!Number.isInteger(rawPage) || rawPage < 1) return { error: bad("page", ">= 1") }
  if (!Number.isInteger(pageSize) || pageSize < 0 || pageSize > 5000) return { error: bad("pageSize", "0..5000") }
  // A huge page (1e20) would overflow OFFSET: past MAX_PAGE every page is empty anyway.
  const page = Math.min(rawPage, MAX_PAGE)
  const fromDate = (search.get("fromDate") ?? search.get("begin_date") ?? "").trim()
  const toDate = (search.get("toDate") ?? search.get("end_date") ?? "").trim()
  if (fromDate && !ISO_DAY.test(fromDate)) return { error: bad("fromDate", "YYYY-MM-DD") }
  if (toDate && !ISO_DAY.test(toDate)) return { error: bad("toDate", "YYYY-MM-DD") }
  const ordering = (search.get("ordering") ?? "-id").trim() || "-id"
  if (!ORDERINGS.includes(ordering as StockInventoryOrdering)) return { error: bad("ordering", ORDERINGS.join(" | ")) }
  return {
    data: {
      search: (search.get("search") ?? "").trim().slice(0, 200),
      status: status as StockInventoryStatus | "",
      warehouses: texts([...search.getAll("warehouse"), ...search.getAll("stock")]),
      createdBy: texts([...search.getAll("createdBy"), ...search.getAll("created_by")]),
      fromDate,
      toDate,
      ordering: ordering as StockInventoryOrdering,
      page,
      pageSize,
    },
  }
}

/** GET /api/stock/inventories/balances?warehouse &date (YYYY-MM-DD, default today) &forDayEnd=0|1 (default 1). */
export function parseBalancesQuery(url: string): Parsed<{ warehouse: string; date: string; forDayEnd: boolean }> {
  const search = new URL(url).searchParams
  const warehouse = (search.get("warehouse") ?? search.get("stock") ?? "").trim()
  if (!warehouse) return { error: bad("warehouse", "required") }
  const date = (search.get("date") ?? "").trim()
  if (date && !ISO_DAY.test(date)) return { error: bad("date", "YYYY-MM-DD") }
  const rawEnd = (search.get("forDayEnd") ?? search.get("for_day_end") ?? "1").trim().toLowerCase()
  return { data: { warehouse, date, forDayEnd: !["0", "false", "no"].includes(rawEnd) } }
}

const REQUIRED = "Обязательное поле"

/** Counted amount: number ≥ 0 ("1 000,5" strings accepted, blank = 0; "0x10" / "12abc" are refused). */
const amountSchema = z.preprocess(
  (value) => (typeof value === "string" ? (value.trim() ? strictNumber(value, { locale: true }) : 0) : value),
  z.number({ error: "Введите число" }).finite("Введите число").min(0, "Количество не может быть отрицательным").max(1e9, "Слишком большое число"),
)

const lineSchema = z.object({
  key: z.string().trim().min(1, REQUIRED).max(300),
  amount: amountSchema,
  series: z.string().trim().max(200).optional(),
})

const headerShape = {
  type: z.enum(["fact_date", "custom_date"]).default("fact_date"),
  warehouse: z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(255),
  invDate: z.string().trim().optional(),
  forDayEnd: z.boolean().optional(),
  comment: z.string().max(2000).optional(),
}

/** POST /api/stock/inventories, PUT /api/stock/inventories/[id]. */
export const inventoryInputSchema = z.object({
  ...headerShape,
  items: z.array(lineSchema).max(5000, "Слишком много товаров"),
})

/** POST /api/stock/inventories/import — rows of the filled template. */
export const inventoryImportSchema = z.object({
  ...headerShape,
  rows: z
    .array(
      z.object({
        name: z.coerce.string().max(300).optional(),
        article: z.coerce.string().max(100).optional(),
        amount: z.union([z.number(), z.string().max(40), z.null()]),
        line: z.number().int().optional(),
      }),
    )
    .max(10000, "Слишком много строк"),
})

/** POST /api/stock/inventories/[id]/confirm {comment?} (demo InventoryVerifyForm). */
export const inventoryConfirmSchema = z.object({ comment: z.string().max(2000).optional() })

/**
 * Reads and validates a JSON body like parseJsonBody, but answers with the first
 * issue as a translatable `error` (+ `field`, e.g. "items.2.amount") so the dialog
 * can show it. `optional` = an empty body reads as {} (confirm without a comment).
 */
export async function parseInventoryBody<T>(request: Request, schema: z.ZodType<T>, optional = false): Promise<Parsed<T>> {
  const text = await request.text()
  let json: unknown = {}
  if (text.trim() || !optional) {
    try {
      json = JSON.parse(text)
    } catch {
      return { error: NextResponse.json({ error: NOT_JSON_MESSAGE }, { status: 400 }) }
    }
  }
  // Zero-width / bidi characters are dropped from every text; NUL and broken Unicode answer 400.
  const cleaned = cleanJsonText(json)
  if (cleaned.issue) return { error: NextResponse.json({ error: cleaned.issue.message, field: cleaned.issue.field || null }, { status: 400 }) }
  const result = schema.safeParse(cleaned.value)
  if (!result.success) return { error: zodErrorResponse(result.error) }
  return { data: result.data }
}
