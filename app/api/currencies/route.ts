import { NextRequest, NextResponse } from "next/server"

import { currencyErrorResponse, currencySchema } from "@/app/api/currencies/schema"
import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { createCurrency, listCurrencies } from "@/lib/currencies-repo"
import { requireRole } from "@/lib/rbac"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listCurrencies())
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
