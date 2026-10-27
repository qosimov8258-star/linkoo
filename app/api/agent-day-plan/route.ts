import { NextRequest, NextResponse } from "next/server"

import { getAgentDayPlan } from "@/lib/agent-day-plan-repo"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/agent-day-plan?user=188&date=2025-06-03 → the header numbers of the agent day card.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const p = request.nextUrl.searchParams
  const id = Number(p.get("user"))
  const date = p.get("date") ?? ""
  if (!Number.isInteger(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "user/date" }, { status: 400 })
  return NextResponse.json(await getAgentDayPlan(id, date))
}
