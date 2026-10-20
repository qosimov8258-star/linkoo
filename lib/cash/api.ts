import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { isIsoDay } from "@/lib/finance/dates"
import { CashError, isDbId, MAX_DB_ID, MAX_MONEY, MAX_PAGE, MAX_PAGE_SIZE, MAX_RATE } from "@/lib/cash/common"
import type { CashListQuery } from "@/lib/cash/list"
import { MONEY_REQUEST_STATUSES, type MoneyRequestStatus } from "@/lib/cash/types"

// Query / body schemas of the /api/cash/** routes (zod v4) and the shared
// error mapping. List params are repeated (?cashbox=1&cashbox=2); id lists also
// accept the demo's "1-2-3" form. Booleans: 1 / true. Ids beyond int4 are
// ignored (they cannot exist), page / pageSize are clamped, money |x| ≤ 1e13,
// rates 0 < x ≤ 1e9 (contract 3).

export type ParsedQuery<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

/** CashError → { error, field } with its status. A Postgres data error (class 22:
 * value out of range, invalid date, …) is bad input → 400; anything else is
 * logged and answered with a generic 500 (never the database message). */
export function cashErrorResponse(error: unknown): NextResponse {
  if (error instanceof CashError) return NextResponse.json({ error: error.message, field: error.field ?? null }, { status: error.status })
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === "string" && code.startsWith("22")) {
    console.warn("[cash] rejected input:", (error as Error).message)
    return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", field: null }, { status: 400 })
  }
  console.error("[cash] unexpected error", error)
  return NextResponse.json({ error: "Внутренняя ошибка сервера", field: null }, { status: 500 })
}

function invalid(error: z.ZodError) {
  return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: error.flatten() }, { status: 400 })
}

function params(url: string) {
  return new URL(url).searchParams
}

function idList(search: URLSearchParams, name: string): number[] {
  return search
    .getAll(name)
    .flatMap((value) => value.split(/[,-]/))
    .map((value) => Number(value.trim()))
    .filter(isDbId)
}

function textList(search: URLSearchParams, name: string): string[] {
  return search
    .getAll(name)
    .map((value) => value.trim())
    .filter(Boolean)
}

function flag(search: URLSearchParams, name: string): boolean {
  const value = search.get(name)
  return value === "1" || value === "true" || value === "True"
}

function day(search: URLSearchParams, name: string): string | undefined | null {
  const value = search.get(name)?.trim()
  if (!value) return undefined
  return isIsoDay(value) ? value : null
}

function intParam(search: URLSearchParams, name: string): number | undefined {
  const value = search.get(name)
  if (value === null || value === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined
}

/** page (1..MAX_PAGE) and pageSize (0 = all, else 1..MAX_PAGE_SIZE) of a list query; huge values are clamped. */
function paging(search: URLSearchParams): { page?: number; pageSize?: number } {
  const page = intParam(search, "page")
  const pageSize = intParam(search, "pageSize")
  return {
    page: page === undefined ? undefined : Math.min(MAX_PAGE, Math.max(1, page)),
    pageSize: pageSize === undefined || pageSize < 0 ? undefined : Math.min(MAX_PAGE_SIZE, pageSize),
  }
}

function badParam(name: string, hint = "YYYY-MM-DD") {
  return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: { fieldErrors: { [name]: [hint] } } }, { status: 400 })
}

/** GET /api/cash/operations, /total, /unverified query → CashListQuery. */
export function parseCashListQuery(url: string): ParsedQuery<CashListQuery> {
  const search = params(url)
  const from = day(search, "from")
  const to = day(search, "to")
  if (from === null) return { error: badParam("from") }
  if (to === null) return { error: badParam("to") }
  const paymentType = search.get("paymentType") ?? ""
  if (!["", "cash", "bank"].includes(paymentType)) return { error: badParam("paymentType", "cash | bank") }
  const sources = textList(search, "source").filter((value): value is NonNullable<CashListQuery["sources"]>[number] =>
    ["cash", "customer", "supplier", "acceptance"].includes(value),
  )
  return {
    data: {
      cashboxIds: idList(search, "cashbox"),
      types: idList(search, "type"),
      branches: textList(search, "branch"),
      organizations: textList(search, "organization"),
      expenseCategoryIds: idList(search, "expenseCategory"),
      incomeCategoryIds: idList(search, "incomeCategory"),
      paymentType: paymentType as CashListQuery["paymentType"],
      clientIds: idList(search, "client"),
      supplierIds: idList(search, "supplier"),
      staffIds: idList(search, "staff"),
      from: from ?? undefined,
      to: to ?? undefined,
      withDeleted: flag(search, "withDeleted"),
      internalTransfer: flag(search, "internalTransfer"),
      onlyNotInternal: flag(search, "onlyNotInternal"),
      search: search.get("search")?.trim() || undefined,
      sources,
      ordering: search.get("ordering")?.trim() || undefined,
      ...paging(search),
    },
  }
}

/** GET /api/cash/accept-cash query. */
export function parseAcceptGroupsQuery(url: string): ParsedQuery<{ from?: string; to?: string; branches: string[]; agentCashboxIds: number[] }> {
  const search = params(url)
  const from = day(search, "from")
  const to = day(search, "to")
  if (from === null) return { error: badParam("from") }
  if (to === null) return { error: badParam("to") }
  return { data: { from: from ?? undefined, to: to ?? undefined, branches: textList(search, "branch"), agentCashboxIds: idList(search, "cashbox") } }
}

/** GET /api/cash/accept-cash/payments query (one group). */
export function parseAcceptPaymentsQuery(url: string): ParsedQuery<{
  agent: string
  currency: string
  organization: string
  branch: string
  agentCashboxId: number | null
  from?: string
  to?: string
  page?: number
  pageSize?: number
}> {
  const search = params(url)
  const from = day(search, "from")
  const to = day(search, "to")
  if (from === null) return { error: badParam("from") }
  if (to === null) return { error: badParam("to") }
  const currency = search.get("currency")?.trim() ?? ""
  if (!currency) return { error: badParam("currency", "required") }
  return {
    data: {
      agent: search.get("agent") ?? "",
      currency,
      organization: search.get("organization") ?? "",
      branch: search.get("branch") ?? "",
      agentCashboxId: idList(search, "agentCashbox")[0] ?? null,
      from: from ?? undefined,
      to: to ?? undefined,
      ...paging(search),
    },
  }
}

/** GET /api/cash/money-requests query. */
export function parseMoneyRequestsQuery(url: string): ParsedQuery<{
  status: MoneyRequestStatus | ""
  search?: string
  supplierIds: number[]
  ordering?: string
  page?: number
  pageSize?: number
}> {
  const search = params(url)
  const status = search.get("status")?.trim() ?? ""
  if (status && !(MONEY_REQUEST_STATUSES as readonly string[]).includes(status)) return { error: badParam("status", "pending | approved | given | cancelled") }
  return {
    data: {
      status: status as MoneyRequestStatus | "",
      search: search.get("search")?.trim() || undefined,
      supplierIds: idList(search, "supplier"),
      ordering: search.get("ordering")?.trim() || undefined,
      ...paging(search),
    },
  }
}

/** GET /api/cash/expected-payments query. */
export function parseExpectedPaymentsQuery(url: string): ParsedQuery<{
  search?: string
  clientIds: number[]
  statuses: string[]
  from?: string
  to?: string
  onlyOpen: boolean
  ordering?: string
  page?: number
  pageSize?: number
}> {
  const search = params(url)
  const from = day(search, "from")
  const to = day(search, "to")
  if (from === null) return { error: badParam("from") }
  if (to === null) return { error: badParam("to") }
  return {
    data: {
      search: search.get("search")?.trim() || undefined,
      clientIds: idList(search, "client"),
      statuses: textList(search, "status"),
      from: from ?? undefined,
      to: to ?? undefined,
      onlyOpen: search.get("all") !== "1",
      ordering: search.get("ordering")?.trim() || undefined,
      ...paging(search),
    },
  }
}

// --- bodies -------------------------------------------------------------------

const id = z.coerce.number().int().positive().max(MAX_DB_ID, { error: "Не найдено" })
const optId = id.optional()
/** Money: |x| ≤ 1e13 (contract 3). */
const money = z.coerce.number().finite().min(-MAX_MONEY, { error: "Слишком большая сумма" }).max(MAX_MONEY, { error: "Слишком большая сумма" })
const text = z.string().trim()
const optText = text.optional()
const rateType = z.enum(["current", "order", "custom"]).optional()
const optRate = z.coerce.number().finite().positive().max(MAX_RATE, { error: "Слишком большой курс" }).optional()

const operationFields = {
  date: optText,
  cashboxId: id,
  branch: optText,
  organization: optText,
  categoryId: optId,
  amount: money.nonnegative().optional(),
  comment: optText,
  isVerified: z.boolean().optional(),
  clientId: optId,
  contractId: optId,
  orderId: optId,
  supplierId: optId,
  supplyId: optId,
  supplyExpenseId: optId,
  responsibleId: optId,
  staff: z.array(z.object({ employeeId: id, amount: money.nonnegative() })).optional(),
  children: z.array(z.object({ name: text, amount: money.nonnegative() })).optional(),
  amortizationFrom: optText,
  amortizationTo: optText,
  debtCurrency: optText,
  rateType,
  customRate: optRate,
  debtRate: optRate,
}

/** Body of POST /api/cash/operations and PUT /api/cash/operations/[key] (CashOperationInput). */
export const cashOperationSchema = z.object({
  kind: z.enum(["income", "expense"]),
  ...operationFields,
  moneyRequestId: optId,
})

/** Body of POST /api/cash/orders/[id]/pay. */
export const payOrderSchema = z.object(operationFields).omit({ orderId: true, supplierId: true, supplyId: true })

/** Body of POST /api/cash/money-requests/[id]/pay (supplier comes from the request). */
export const payMoneyRequestSchema = z.object(operationFields).omit({ supplierId: true, clientId: true, orderId: true })

export const verifySchema = z.object({ verifyDate: z.string().trim().nullable().optional() })

export const duplicateSchema = z.object({ date: optText })

export const transferSchema = z.object({
  fromCashboxId: id,
  toCashboxId: id,
  fromOrganization: optText,
  toOrganization: optText,
  fromBranch: optText,
  toBranch: optText,
  amountFrom: money.positive(),
  amountTo: money.positive().optional(),
  rate: optRate,
  percentage: z.coerce.number().finite().positive().max(1000).optional(),
  date: optText,
  comment: optText,
  accumulatedFrom: optText,
  accumulatedTo: optText,
})

const groupFilter = z.object({
  agent: z.string(),
  currency: text.min(1),
  organization: z.string(),
  branch: z.string(),
  agentCashboxId: id.nullable().optional(),
  from: optText,
  to: optText,
})

/** Body of POST /api/cash/accept-cash: { cashboxId, date?, comment?, ids } or { …, group }. */
export const acceptCashSchema = z
  .object({ cashboxId: id, date: optText, comment: optText, ids: z.array(id).min(1).optional(), group: groupFilter.optional() })
  .refine((value) => Boolean(value.ids?.length) !== Boolean(value.group), { message: "ids or group", path: ["ids"] })

export const updateAcceptanceSchema = z.object({
  payments: z.array(z.object({ id, amount: money.positive() })).optional(),
  branch: optText,
  organization: optText,
  cashboxId: optId,
  deliveryManId: id.nullable().optional(),
  date: optText,
  comment: optText,
})

export const detachSchema = z.object({ paymentId: id })

export const cashGroupPaymentSchema = z.object({
  date: optText,
  cashboxId: id,
  branch: optText,
  categoryId: optId,
  organization: optText,
  comment: optText,
  isVerified: z.boolean().optional(),
  responsibleId: optId,
  debtCurrency: optText,
  rateType,
  customRate: optRate,
  debtRate: optRate,
  rows: z
    .array(
      z.object({
        clientId: id,
        amount: money.positive(),
        contractId: optId,
        organization: optText,
        date: optText,
        comment: optText,
      }),
    )
    .min(1),
})

export const groupPaymentMatchSchema = z.object({
  rows: z
    .array(
      z.object({
        client: optText,
        inn: optText,
        code: optText,
        amount: z.union([z.number(), z.string()]).optional(),
        organization: optText,
        date: optText,
        comment: optText,
      }),
    )
    .max(5000),
})

export const moneyRequestUpdateSchema = z.object({
  status: z.enum(["approved", "cancelled"]),
  amount: money.positive().optional(),
  currency: optText,
  comment: optText,
})

export const convertSchema = z.object({
  from: z.string().trim().default(""),
  to: z.string().trim().default(""),
  amount: money.optional(),
  fromRate: optRate,
  toRate: optRate,
  cashboxId: optId,
})

/** GET /api/cash/convert query → convertSchema input. */
export function parseConvertQuery(url: string) {
  const search = params(url)
  const raw: Record<string, string> = {}
  for (const name of ["from", "to", "amount", "fromRate", "toRate", "cashboxId"]) {
    const value = search.get(name)
    if (value !== null && value !== "") raw[name] = value
  }
  const parsed = convertSchema.safeParse(raw)
  return parsed.success ? { data: parsed.data } : { error: invalid(parsed.error) }
}
