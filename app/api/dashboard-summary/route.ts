import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDashboardSummary } from "@/lib/dashboard-summary-repo"

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const begin = request.nextUrl.searchParams.get("begin")
  const end = request.nextUrl.searchParams.get("end")
  if (!begin || !end) {
    return NextResponse.json({ error: "Требуются begin и end" }, { status: 400 })
  }

  return NextResponse.json((await getDashboardSummary(begin, end)))
}
