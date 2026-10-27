import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getAgentDay } from "@/lib/tracking-day-repo"

/** GET /api/tracking/way/day?agent=ID&date=YYYY-MM-DD → the tracker points, the client plans and the totals of the agent's day. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = request.nextUrl.searchParams
  const agent = Number(params.get("agent"))
  const date = params.get("date") ?? ""
  if (!Number.isInteger(agent) || agent <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Неверные параметры" }, { status: 400 })
  return NextResponse.json(await getAgentDay(agent, date))
}
