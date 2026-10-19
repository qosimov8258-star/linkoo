import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { isIsoDay } from "@/lib/finance/dates"
import { TRANSFER_SORT_KEYS, type TransferListQuery } from "@/lib/internal-transfers-list"
import { isTransferError, type TransferChange, type TransferInput } from "@/lib/internal-transfers-repo"
import { TRANSFER_ACTIONS, TRANSFER_STATUSES, type TransferStatus } from "@/lib/internal-transfers-types"

// Request parsing of /api/internal-transfers/**: zod schemas of the bodies
// (camelCase, legacy fields accepted) and of the list query string.

const num = z.union([z.number(), z.string()]).optional()
const text = (max = 500) => z.string().max(max).optional()

const lineSchema = z.object({
  id: num,
  key: text(300),
  product: z.union([z.string().max(500), z.number()]).optional(),
  quantity: num,
  amount: num,
  price: num,
  series: text(200),
  weight: num,
})

export const transferBodySchema = z.object({
  fromWarehouse: z.string().trim().min(1).max(300),
  toWarehouse: z.string().trim().min(1).max(300),
  createdAt: text(40),
  deliveredAt: text(40),
  priceList: text(300),
  currency: text(20),
  organization: text(300),
  invoiceNumber: text(200),
  transportNumber: text(200),
  driver: text(200),
  comment: text(2000),
  /** Demo "Подтвержденный" (default on). */
  isConfirmed: z.boolean().optional(),
  /** Demo "Сразу передать товары без потверждения" (create only): give and accept at once. */
  autoAccept: z.boolean().optional(),
  status: z.string().optional(),
  items: z.array(lineSchema).max(2000).optional(),
})

export type TransferBody = z.infer<typeof transferBodySchema>

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

/** Body → repo input. Status: autoAccept → 'принят'; else an explicit status;
 * else isConfirmed (default true) → 'потвержден' / 'ожидает'. */
export function toTransferInput(body: TransferBody): TransferInput {
  const explicit = TRANSFER_STATUSES.includes(body.status as TransferStatus) ? (body.status as TransferStatus) : null
  const status: TransferStatus = body.autoAccept ? "принят" : (explicit ?? (body.isConfirmed === false ? "ожидает" : "потвержден"))
  return {
    fromWarehouse: body.fromWarehouse,
    toWarehouse: body.toWarehouse,
    createdAt: body.createdAt ?? "",
    deliveredAt: body.deliveredAt ?? "",
    priceList: (body.priceList ?? "").trim(),
    currency: (body.currency ?? "").trim(),
    organization: (body.organization ?? "").trim(),
    invoiceNumber: (body.invoiceNumber ?? "").trim(),
    transportNumber: (body.transportNumber ?? "").trim(),
    driver: (body.driver ?? "").trim(),
    comment: (body.comment ?? "").trim(),
    status,
    items: (body.items ?? []).map((line) => ({
      key: line.key?.trim() || undefined,
      product: line.product === undefined ? undefined : String(line.product),
      quantity: toNumber(line.quantity ?? line.amount),
      price: toNumber(line.price),
      series: line.series,
    })),
  }
}

export const transferActionSchema = z.object({
  action: z.enum(TRANSFER_ACTIONS as [string, ...string[]]),
  comment: z.string().max(2000).optional(),
  /** Day of the movement (demo confirm dialog "Дата"), YYYY-MM-DD; default today. */
  date: z
    .string()
    .optional()
    .refine((value) => !value || isIsoDay(value), "date"),
})

export function transferResponse(result: TransferChange, created = false) {
  if (isTransferError(result)) return NextResponse.json({ error: result.error, ...(result.shortages ? { shortages: result.shortages } : {}) }, { status: result.status })
  return NextResponse.json(result, { status: created ? 201 : 200 })
}

const day = (value: string | null) => (value && isIsoDay(value) ? value : "")

/** Query string → list query; `null` when the caller asked for the legacy array (no paging params). */
export function parseTransferListQuery(url: string): TransferListQuery | null {
  const params = new URL(url).searchParams
  if (!params.has("page") && !params.has("pageSize")) return null
  const list = (name: string) => [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))].slice(0, 200)
  const ordering = params.get("ordering") ?? ""
  const pageSize = Number(params.get("pageSize"))
  return {
    search: (params.get("search") ?? "").slice(0, 200),
    ordering: TRANSFER_SORT_KEYS.includes(ordering.replace(/^-/, "")) ? ordering : "",
    page: Math.max(1, Math.floor(Number(params.get("page")) || 1)),
    pageSize: Number.isFinite(pageSize) && pageSize >= 0 ? Math.min(5000, Math.floor(pageSize)) : 25,
    fromWarehouse: list("fromWarehouse"),
    toWarehouse: list("toWarehouse"),
    warehouse: list("warehouse"),
    status: list("status").filter((status): status is TransferStatus => TRANSFER_STATUSES.includes(status as TransferStatus)),
    createdBy: list("createdBy"),
    createdFrom: day(params.get("createdFrom")),
    createdTo: day(params.get("createdTo")),
    deliveryFrom: day(params.get("deliveryFrom")),
    deliveryTo: day(params.get("deliveryTo")),
    acceptedFrom: day(params.get("acceptedFrom")),
    acceptedTo: day(params.get("acceptedTo")),
    givenFrom: day(params.get("givenFrom")),
    givenTo: day(params.get("givenTo")),
    withCancelled: ["1", "true"].includes(params.get("withCancelled") ?? ""),
    ids: list("ids")
      .flatMap((value) => value.split(","))
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  }
}
