import { NextRequest, NextResponse } from "next/server"

import { currencyErrorResponse, currencySchema } from "@/app/api/currencies/schema"
import { getAppCurrency } from "@/lib/app-currency"
import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { createCurrency, listCurrencies } from "@/lib/currencies-repo"
import { normCurrency } from "@/lib/finance/currency"
import { requireRole } from "@/lib/rbac"

// GET /api/currencies — with an app currency (Настройки → Валюта приложения) only that one, so every
// currency select of the app offers it alone; ?all=1 (Валюты, the setting itself) lists every currency.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const currencies = await listCurrencies()
  const work = request.nextUrl.searchParams.get("all") === "1" ? "" : await getAppCurrency()
  return NextResponse.json(work ? currencies.filter((currency) => normCurrency(currency.code) === work) : currencies)
}

// POST /api/currencies {name, code, rate, isBase?} — 400 for a missing, non-numeric
// or out-of-range rate, 409 only when the code is really taken.
export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, currencySchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createCurrency(parsed.data), { status: 201 })
  } catch (error) {
    const response = currencyErrorResponse(error)
    if (response) return response
    throw error
  }
}
