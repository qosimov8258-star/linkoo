import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDashboardSummary } from "@/lib/dashboard-summary-repo"
import { invalidFieldResponse } from "@/lib/validation"

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2100-12-31"
}

// GET /api/dashboard-summary?begin=YYYY-MM-DD&end=YYYY-MM-DD → DashboardSummary (local days, inclusive).
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const begin = request.nextUrl.searchParams.get("begin")
  const end = request.nextUrl.searchParams.get("end")
  if (!begin || !end) {
    return NextResponse.json({ error: "Требуются begin и end" }, { status: 400 })
  }
  if (!validDay(begin) || !validDay(end)) {
    return invalidFieldResponse(validDay(begin) ? "end" : "begin", "YYYY-MM-DD")
  }
  if (begin > end) {
    return NextResponse.json({ error: "begin должен быть не позже end" }, { status: 400 })
  }

  return NextResponse.json(await getDashboardSummary(begin, end))
}
