import { NextResponse } from "next/server"

import { createDelivererCorrection } from "@/lib/finance-deliverer-debts"
import { delivererCorrectionSchema } from "@/lib/finance-deliverer-debts-api"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/balances/deliverer-debts/corrections — "КОРРЕКТИРОВКА" of a
// deliverer (column "Корректировка" of GET /api/balances/deliverer).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, delivererCorrectionSchema)
  if (parsed.error) return parsed.error

  const result = await createDelivererCorrection(parsed.data, auth.user.displayName)
  if (result === "employee_not_found") return NextResponse.json({ error: "Доставщик не найден" }, { status: 404 })
  if (result === "currency_not_found") return NextResponse.json({ error: "Валюта не найдена" }, { status: 400 })
  return NextResponse.json(result, { status: 201 })
}
