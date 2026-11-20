import { NextResponse } from "next/server"
import { z } from "zod"

import { MAX_AMOUNT_DIGITS } from "@/lib/amount-precision"
import { loadAmountPrecision, saveAmountPrecision } from "@/lib/amount-precision-server"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// GET /api/settings/amount-precision → { digits, supplyDigits } — Настройки → Округление сумм (0 = not set).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await loadAmountPrecision(undefined, { fresh: true }))
}

const digits = z.number().int().min(0).max(MAX_AMOUNT_DIGITS)
const schema = z.object({ digits, supplyDigits: digits.optional() })

// PUT /api/settings/amount-precision { digits, supplyDigits? } — the decimals amounts are printed, rounded and typed
// with (the reference's ROUND_AMOUNT_FOR_CURRENCY / SUPPLY_ROUND_AMOUNT); 0 = not set (three decimals).
export async function PUT(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return NextResponse.json(await saveAmountPrecision({ digits: parsed.data.digits, supplyDigits: parsed.data.supplyDigits ?? 0 }, auth.user.displayName))
}
