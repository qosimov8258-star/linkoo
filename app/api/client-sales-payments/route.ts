import { NextRequest, NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { dbErrorResponse } from "@/lib/db-errors"
import { parseDocDay } from "@/lib/document-dates"
import { getClientSalesPayments } from "@/lib/finance/client-sales-payments"

const MAX_FILTER_VALUES = 500
const MAX_FILTER_TEXT = 300

const fail = (error: string, field?: string) => NextResponse.json({ error, ...(field ? { field } : {}) }, { status: 400 })

/** Repeated params (?zone=a&zone=b); null when the list is longer than a filter takes. */
function list(params: URLSearchParams, key: string): string[] | null {
  const values = params.getAll(key).map((value) => value.trim()).filter(Boolean)
  return values.length > MAX_FILTER_VALUES || values.some((value) => value.length > MAX_FILTER_TEXT) ? null : values
}

// GET /api/client-sales-payments?from&to[&agent&organization&clientType&zone&branch] — «Продажа и оплата по
// магазинам» (Linko's market_order_and_payment): per shop the period's sales, returns, their cost, payments and
// discounts in the base currency (lib/finance/client-sales-payments.ts). It shows the cost of goods, so it is read
// by the same users as P&L. from / to are business days, from ≤ to.
export async function GET(request: NextRequest) {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  try {
    const bounds: Record<string, string> = {}
    for (const key of ["from", "to"]) {
      const raw = params.get(key)?.trim() ?? ""
      if (!raw) return fail("Укажите период", key)
      const day = parseDocDay(raw, { allowFuture: true })
      if (!day.ok) return fail(day.error, key)
      bounds[key] = day.date
    }
    if (bounds.from > bounds.to) return fail("Дата начала позже даты окончания", "from")
    const filters = {
      agents: list(params, "agent"),
      organizations: list(params, "organization"),
      clientTypes: list(params, "clientType"),
      zones: list(params, "zone"),
      branches: list(params, "branch"),
    }
    const tooLong = Object.entries(filters).find(([, values]) => values === null)
    if (tooLong) return fail("Слишком много значений", tooLong[0])
    return NextResponse.json(
      await getClientSalesPayments({
        from: bounds.from,
        to: bounds.to,
        agents: filters.agents ?? [],
        organizations: filters.organizations ?? [],
        clientTypes: filters.clientTypes ?? [],
        zones: filters.zones ?? [],
        branches: filters.branches ?? [],
      }),
    )
  } catch (error) {
    const response = dbErrorResponse(error)
    if (response) return response
    throw error
  }
}
