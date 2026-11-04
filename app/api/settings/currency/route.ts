import { NextResponse } from "next/server"
import { z } from "zod"

import { AppCurrencyError, getAppCurrency, setAppCurrency } from "@/lib/app-currency"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// GET /api/settings/currency → { currency } — the app currency code ('' = all currencies).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json({ currency: await getAppCurrency() })
}

const schema = z.object({ currency: z.string().trim().max(20) })

// PUT /api/settings/currency { currency } (Настройки → Валюта приложения); '' = every currency again.
export async function PUT(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json({ currency: await setAppCurrency(parsed.data.currency, auth.user.displayName) })
  } catch (error) {
    if (error instanceof AppCurrencyError) return NextResponse.json({ error: error.message, field: "currency" }, { status: error.status })
    throw error
  }
}
