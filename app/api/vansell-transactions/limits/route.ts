import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { vansellLimitsSchema } from "@/lib/finance-vansell-balance-api"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { listVansellLimits, saveVansellLimits } from "@/lib/vansell-transactions-repo"

// Van-sell debt limits ("Изменить лимит", demo van_sell_debt_limit).
// canUpdate tells the page whether to offer the write actions (manager+).

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json({ canUpdate: user.role === "admin" || user.role === "manager", limits: await listVansellLimits() })
}

/** Body: [{ employeeId, limit }] (blank limit → 0). */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, vansellLimitsSchema)
  if (parsed.error) return parsed.error

  const result = await saveVansellLimits(parsed.data, auth.user.displayName)
  if (result === "employee_not_found") return NextResponse.json({ error: "Вансел не найден" }, { status: 404 })
  return NextResponse.json({ limits: result })
}
