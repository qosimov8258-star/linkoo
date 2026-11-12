import { NextRequest, NextResponse } from "next/server"

import { canReadCompanyMoney } from "@/lib/company-money"
import { getCurrentUser } from "@/lib/current-user"
import { getDelivererWidget } from "@/lib/dashboard-deliverers"
import { invalidFieldResponse } from "@/lib/validation"

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2100-12-31"
}

// GET /api/dashboard-deliverers?begin=YYYY-MM-DD&end=YYYY-MM-DD → DelivererWidget (the dashboard's deliverer widget,
// Linko's stats/widget/delivery; lib/dashboard-deliverers.ts). Company money: only for its readers.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const begin = request.nextUrl.searchParams.get("begin") ?? ""
  const end = request.nextUrl.searchParams.get("end") ?? ""
  if (!validDay(begin) || !validDay(end)) return invalidFieldResponse(validDay(begin) ? "end" : "begin", "YYYY-MM-DD")
  if (begin > end) return NextResponse.json({ error: "begin должен быть не позже end" }, { status: 400 })
  if (!canReadCompanyMoney(user)) {
    return NextResponse.json({ rows: [], total: { order: 0, orderMarkets: 0, orderReturn: 0, dateReturn: 0, plan: 0, done: 0, undone: 0, donePercent: 0, collect: 0, collectMarkets: 0, taken: 0 } })
  }
  return NextResponse.json(await getDelivererWidget(begin, end))
}
