import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { isIsoDay } from "@/lib/finance/dates"
import { parsePageParam } from "@/lib/stock/paging"
import { WRITE_OFF_SORT_KEYS, isWriteOffError, type WriteOffChange, type WriteOffInput, type WriteOffListQuery } from "@/lib/write-offs-repo"
import { WRITE_OFF_ACTIONS, WRITE_OFF_STATUSES, type WriteOffStatus } from "@/lib/write-offs-types"

// Request parsing of /api/write-offs/** (the legacy body with reason / cost /
// sum is still accepted; costs are always recomputed on the server).

const num = z.union([z.number(), z.string()]).optional()

export const writeOffBodySchema = z.object({
  warehouse: z.string().trim().min(1).max(300),
  date: z.string().max(40).optional(),
  comment: z.string().max(2000).optional(),
  reason: z.string().max(300).optional(),
  /** 'закрыт' (default) or 'ожидает'. */
  status: z.enum(["закрыт", "ожидает"]).optional(),
  items: z
    .array(
      z.object({
        id: num,
        key: z.string().max(300).optional(),
        product: z.union([z.string().max(500), z.number()]).optional(),
        qty: num,
        amount: num,
        series: z.string().max(200).optional(),
        code: z.string().optional(),
        block: num,
        cost: num,
        sum: num,
        /** Defective units (Брак). */
        defect: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(2000),
})

/** A number field ("1 000,5" accepted); blank = 0; anything else unparseable = NaN (the repo refuses it). */
const toNumber = (value: unknown) => {
  if (value === undefined || value === null || String(value).trim() === "") return 0
  return Number(String(value).replace(/\s/g, "").replace(",", "."))
}

export function toWriteOffInput(body: z.infer<typeof writeOffBodySchema>): WriteOffInput {
  return {
    warehouse: body.warehouse,
    date: body.date ?? "",
    comment: body.comment ?? "",
    reason: body.reason ?? "",
    status: body.status ?? "закрыт",
    items: body.items.map((line) => ({
      key: line.key?.trim() || undefined,
      product: line.product === undefined ? undefined : String(line.product),
      qty: toNumber(line.qty ?? line.amount),
      series: line.series && line.series !== "-" ? line.series : "",
      defect: line.defect === true,
    })),
  }
}

export const writeOffActionSchema = z.object({ action: z.enum(WRITE_OFF_ACTIONS as [string, ...string[]]), comment: z.string().max(2000).optional() })

export function writeOffResponse(result: WriteOffChange, created = false) {
  if (isWriteOffError(result)) {
    return NextResponse.json({ error: result.error, ...(result.field ? { field: result.field } : {}), ...(result.shortages ? { shortages: result.shortages } : {}) }, { status: result.status })
  }
  return NextResponse.json(result, { status: created ? 201 : 200 })
}

/** Query string → list query; `null` = legacy array (no paging params). */
export function parseWriteOffListQuery(url: string): WriteOffListQuery | null {
  const params = new URL(url).searchParams
  if (!params.has("page") && !params.has("pageSize")) return null
  const list = (name: string) => [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))].slice(0, 200)
  const ordering = params.get("ordering") ?? ""
  const pageSize = Number(params.get("pageSize"))
  const day = (value: string | null) => (value && isIsoDay(value) ? value : "")
  return {
    search: (params.get("search") ?? "").slice(0, 200),
    ordering: WRITE_OFF_SORT_KEYS.includes(ordering.replace(/^-/, "")) ? ordering : "",
    page: parsePageParam(params.get("page")),
    pageSize: Number.isFinite(pageSize) && pageSize >= 0 ? Math.min(5000, Math.floor(pageSize)) : 25,
    warehouse: list("warehouse"),
    creator: list("creator"),
    status: list("status").filter((status): status is WriteOffStatus => WRITE_OFF_STATUSES.includes(status as WriteOffStatus)),
    fromDate: day(params.get("fromDate")),
    toDate: day(params.get("toDate")),
  }
}
