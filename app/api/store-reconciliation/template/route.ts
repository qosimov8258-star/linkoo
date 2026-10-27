import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseStoreReconciliationQuery } from "@/lib/finance-store-reconciliation"
import { getDebtTemplate, parseDebtTemplateQuery } from "@/lib/finance-store-reconciliation-writes"
import { INVALID_DATA_MESSAGE, notSignedInResponse, zodErrorResponse } from "@/lib/validation"

// GET /api/store-reconciliation/template — "1. Скачать шаблон" of "Установить
// долг с Excel" (demo sales/market_balance/export_balance_excel): the list
// filters + templateDate, currency, templateOrganization*, byPaymentType →
// {header, rows} with each client's balance on that day (the page builds the .xlsx).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const filters = parseStoreReconciliationQuery(request.url)
  if (filters.error) return filters.error
  const parsed = parseDebtTemplateQuery(request.url, filters.data)
  if (!parsed.data) return parsed.error ? zodErrorResponse(parsed.error) : NextResponse.json({ error: INVALID_DATA_MESSAGE }, { status: 400 })

  return NextResponse.json(await getDebtTemplate(parsed.data))
}
