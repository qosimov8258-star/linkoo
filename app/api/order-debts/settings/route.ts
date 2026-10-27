import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"
import { getOrderDebtConfig, orderDebtConfigSchema, orderDebtErrorResponse, setOrderDebtConfig } from "@/lib/finance-order-debts"

// GET /api/order-debts/settings → OrderDebtConfig (aging periods, default 7 / 30 / 120).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getOrderDebtConfig())
}

// PUT /api/order-debts/settings { firstDebtPeriod, secondDebtPeriod, thirdDebtPeriod } ("Настроить период").
export async function PUT(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, orderDebtConfigSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await setOrderDebtConfig(parsed.data, auth.user.displayName))
  } catch (error) {
    return orderDebtErrorResponse(error)
  }
}
