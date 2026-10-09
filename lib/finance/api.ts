import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { defaultBalancePeriod, isIsoDay } from "@/lib/finance/dates"
import type { BalanceListParams, StatementParams } from "@/lib/finance/ledger"
import type { ManagementParams } from "@/lib/finance/management"
import { BALANCE_ENTITY_KINDS, type BalanceEntityKind } from "@/lib/finance/types"

// Query-string / body schemas of the shared /api/balances/** routes. List
// values (organization, branch, key, …) are repeated params
// (?organization=A&organization=B) because names may contain commas.

export type ParsedQuery<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

const day = z.string().refine(isIsoDay, "YYYY-MM-DD")
const flag = z
  .enum(["1", "0", "true", "false"])
  .optional()
  .transform((value) => value === "1" || value === "true")
const int = (min: number) => z.coerce.number().int().min(min).optional()
const list = z.array(z.string().trim().min(1)).optional()

const movementQuery = {
  from: day.optional(),
  to: day.optional(),
  mode: z.enum(["created", "realization"]).optional(),
  organization: list,
  paymentType: z.enum(["cash", "bank", ""]).optional(),
  orderScope: z.enum(["released", "delivered"]).optional(),
}

const balanceListQuery = z.object({
  ...movementQuery,
  search: z.string().trim().optional(),
  key: list,
  branch: list,
  clientType: list,
  zone: list,
  agent: list,
  deliverer: list,
  collector: list,
  excludeClosed: flag,
  clientCreatedFrom: day.optional(),
  clientCreatedTo: day.optional(),
  orderDaysMin: int(0),
  orderDaysMax: int(0),
  paymentDaysMin: int(0),
  paymentDaysMax: int(0),
  balanceType: z.enum(["debtor", "creditor", "debtor_for_begin", "creditor_for_begin", ""]).optional(),
  balanceCurrency: z.string().trim().optional(),
  groupBy: z.enum(["type"]).optional(),
  ordering: list,
  page: int(1),
  pageSize: int(0),
  totalsIgnoreSearch: flag,
})

const statementQuery = z.object({
  ...movementQuery,
  key: z.string().trim().min(1),
  currency: z.string().trim().optional(),
  column: list,
  category: z.string().trim().optional(),
  counterparty: z.string().trim().optional(),
  search: z.string().trim().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  page: int(1),
  pageSize: int(0),
  withOrganizations: flag,
})

const managementQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  organization: list,
  branch: list,
})

const LIST_ARRAYS = ["organization", "key", "branch", "clientType", "zone", "agent", "deliverer", "collector", "ordering"]
const STATEMENT_ARRAYS = ["organization", "column"]
const MANAGEMENT_ARRAYS = ["organization", "branch"]

function queryObject(url: string, arrays: string[]): Record<string, string | string[]> {
  const params = new URL(url).searchParams
  const out: Record<string, string | string[]> = {}
  for (const name of new Set(params.keys())) {
    if (arrays.includes(name)) out[name] = params.getAll(name).filter((value) => value.trim() !== "")
    else out[name] = params.get(name) ?? ""
  }
  // Empty strings mean "not set" for optional scalar params.
  for (const [name, value] of Object.entries(out)) if (value === "" && name !== "paymentType" && name !== "balanceType") delete out[name]
  return out
}

function invalid(error: z.ZodError) {
  return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: error.flatten() }, { status: 400 })
}

function period(from?: string, to?: string) {
  const fallback = defaultBalancePeriod()
  const start = from ?? fallback.from
  const end = to ?? (from && from > fallback.to ? from : fallback.to)
  return start <= end ? { from: start, to: end } : { from: end, to: start }
}

export function parseBalanceKind(value: string): BalanceEntityKind | null {
  return (BALANCE_ENTITY_KINDS as readonly string[]).includes(value) ? (value as BalanceEntityKind) : null
}

export function parseBalanceListQuery(url: string): ParsedQuery<BalanceListParams> {
  const parsed = balanceListQuery.safeParse(queryObject(url, LIST_ARRAYS))
  if (!parsed.success) return { error: invalid(parsed.error) }
  const q = parsed.data
  return {
    data: {
      ...period(q.from, q.to),
      mode: q.mode,
      organizations: q.organization,
      paymentType: q.paymentType,
      orderScope: q.orderScope ?? null,
      search: q.search,
      keys: q.key,
      branches: q.branch,
      clientTypes: q.clientType,
      zones: q.zone,
      agents: q.agent,
      deliverers: q.deliverer,
      collectors: q.collector,
      excludeClosed: q.excludeClosed,
      clientCreatedFrom: q.clientCreatedFrom,
      clientCreatedTo: q.clientCreatedTo,
      orderDaysMin: q.orderDaysMin,
      orderDaysMax: q.orderDaysMax,
      paymentDaysMin: q.paymentDaysMin,
      paymentDaysMax: q.paymentDaysMax,
      balanceType: q.balanceType,
      balanceCurrency: q.balanceCurrency,
      groupBy: q.groupBy ?? null,
      ordering: q.ordering,
      page: q.page,
      pageSize: q.pageSize,
      totalsIgnoreSearch: q.totalsIgnoreSearch,
    },
  }
}

export function parseStatementQuery(url: string): ParsedQuery<StatementParams> {
  const parsed = statementQuery.safeParse(queryObject(url, STATEMENT_ARRAYS))
  if (!parsed.success) return { error: invalid(parsed.error) }
  const q = parsed.data
  return {
    data: {
      ...period(q.from, q.to),
      key: q.key,
      mode: q.mode,
      organizations: q.organization,
      paymentType: q.paymentType,
      orderScope: q.orderScope ?? null,
      currency: q.currency,
      columns: q.column,
      category: q.category,
      counterparty: q.counterparty,
      search: q.search,
      order: q.order,
      page: q.page,
      pageSize: q.pageSize,
      withOrganizations: q.withOrganizations,
    },
  }
}

export function parseManagementQuery(url: string): ParsedQuery<ManagementParams> {
  const parsed = managementQuery.safeParse(queryObject(url, MANAGEMENT_ARRAYS))
  if (!parsed.success) return { error: invalid(parsed.error) }
  return { data: { ...period(parsed.data.from, parsed.data.to), organizations: parsed.data.organization, branches: parsed.data.branch } }
}

/** Body of POST /api/balances/group-payment. */
export const groupPaymentSchema = z.object({
  date: z.string().trim().optional(),
  cashboxId: z.coerce.number().int().positive(),
  organization: z.string().trim().min(1),
  branch: z.string().trim().optional(),
  incomeCategory: z.string().trim().optional(),
  deliveryMan: z.string().trim().optional(),
  isVerified: z.boolean().optional(),
  rateType: z.enum(["current", "custom"]).optional(),
  customRate: z.coerce.number().positive().optional(),
  comment: z.string().trim().optional(),
  items: z
    .array(
      z.object({
        key: z.union([z.string().trim().min(1), z.number().int().positive().transform(String)]),
        amount: z.coerce.number().finite().positive(),
        comment: z.string().trim().optional(),
      }),
    )
    .min(1),
})
