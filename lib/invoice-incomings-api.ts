import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { normCurrency } from "@/lib/finance/currency"
import { InvoiceError } from "@/lib/invoice-incomings-repo"
import { INVOICE_TABS, type InvoiceInput, type InvoiceListQuery, type InvoiceTab } from "@/lib/invoice-incomings-types"

// HTTP helpers of /api/invoice-incomings/** (route files export only handlers).

export type Parsed<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

function bad(name: string, hint: string) {
  return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: { fieldErrors: { [name]: [hint] } } }, { status: 400 })
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function ids(values: string[]): number[] {
  return [...new Set(values.flatMap((value) => value.split(/[-,]/)).map(Number).filter((value) => Number.isInteger(value) && value > 0))]
}

/**
 * GET /api/invoice-incomings?status=pending|accepted|rejected|all &search &fromDate &toDate (YYYY-MM-DD)
 * &supplier=<id>* &organization=<id>* &currency=<code>* &page &pageSize (0 = all rows)
 */
export function parseInvoiceListQuery(url: string): Parsed<InvoiceListQuery> {
  const search = new URL(url).searchParams
  const tab = (search.get("status") ?? search.get("tab") ?? "all").trim().toLowerCase() || "all"
  if (!INVOICE_TABS.includes(tab as InvoiceTab)) return { error: bad("status", INVOICE_TABS.join(" | ")) }
  const page = Number(search.get("page") ?? 1)
  const pageSize = Number(search.get("pageSize") ?? 25)
  if (!Number.isInteger(page) || page < 1) return { error: bad("page", ">= 1") }
  if (!Number.isInteger(pageSize) || pageSize < 0 || pageSize > 5000) return { error: bad("pageSize", "0..5000") }
  const fromDate = (search.get("fromDate") ?? "").trim()
  const toDate = (search.get("toDate") ?? "").trim()
  if (fromDate && !ISO_DAY.test(fromDate)) return { error: bad("fromDate", "YYYY-MM-DD") }
  if (toDate && !ISO_DAY.test(toDate)) return { error: bad("toDate", "YYYY-MM-DD") }
  const currencies = [...new Set(search.getAll("currency").flatMap((value) => value.split(",")).filter((value) => value.trim()).map((value) => normCurrency(value)))]
  if (currencies.some((code) => !/^[A-Z]{3}$/.test(code))) return { error: bad("currency", "code") }
  return {
    data: {
      tab: tab as InvoiceTab,
      search: (search.get("search") ?? "").trim().slice(0, 200),
      page,
      pageSize,
      fromDate,
      toDate,
      supplierIds: ids(search.getAll("supplier")),
      organizationIds: ids(search.getAll("organization")),
      currencies,
    },
  }
}

const optionalId = z.preprocess((value) => (value === "" || value === undefined ? null : value), z.coerce.number().int().positive().nullable())
const text = (max: number) => z.string().max(max).default("")

const lineSchema = z.object({
  name: text(500),
  ikpu: text(40),
  unit: text(40),
  quantity: z.coerce.number().finite(),
  price: z.coerce.number().finite(),
  vatRate: z.preprocess((value) => (value === "" || value === undefined ? null : value), z.coerce.number().min(0).max(100).nullable()),
  match: z
    .object({ kind: z.enum(["product", "raw_material"]), id: z.coerce.number().int().positive() })
    .nullable()
    .default(null),
})

/** POST /api/invoice-incomings, PUT /api/invoice-incomings/[id]. Business rules live in the repo. */
export const invoiceBodySchema = z.object({
  number: text(60),
  date: text(20),
  contractNumber: text(60),
  contractDate: text(20),
  supplierId: optionalId.default(null),
  supplierName: text(300),
  supplierInn: text(20),
  organizationId: optionalId.default(null),
  buyerName: text(300),
  buyerInn: text(20),
  currency: z.string().max(10).default("SUM"),
  comment: text(2000),
  lines: z.array(lineSchema).max(1000),
})

export function toInvoiceInput(data: z.infer<typeof invoiceBodySchema>): InvoiceInput {
  return { ...data, supplierId: data.supplierId ?? null, organizationId: data.organizationId ?? null }
}

/** PATCH /api/invoice-incomings/[id] — "Принять" / "Отклонить" (with reason) / "Вернуть в ожидание". */
export const invoiceStatusSchema = z.object({
  action: z.enum(["accept", "reject", "reset"]),
  reason: z.string().max(1000).default(""),
})

const cell = z.coerce.string().max(1000).optional()

/** POST /api/invoice-incomings/import — rows of the Excel file; commit = false → preview only. */
export const invoiceImportSchema = z.object({
  commit: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        row: z.coerce.number().int().positive(),
        number: cell,
        date: cell,
        contractNumber: cell,
        contractDate: cell,
        supplierInn: cell,
        supplierName: cell,
        buyerInn: cell,
        buyerName: cell,
        currency: cell,
        comment: cell,
        name: cell,
        ikpu: cell,
        unit: cell,
        quantity: cell,
        price: cell,
        vatRate: cell,
      }),
    )
    .min(1)
    .max(5000),
})

export function parseIdParam(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function invoiceErrorResponse(error: unknown): NextResponse {
  if (error instanceof InvoiceError) return NextResponse.json({ error: error.message, field: error.field ?? null }, { status: error.status })
  throw error
}
