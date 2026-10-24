import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listWayAgents, WAY_GROUPS } from "@/lib/tracking-way-repo"

/** GET /api/tracking/way?group=all|agent|merch|delivery|collector&date=YYYY-MM-DD → the agents of the tracking panel. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = request.nextUrl.searchParams
  const group = params.get("group") ?? "all"
  if (!(WAY_GROUPS as readonly string[]).includes(group)) return NextResponse.json({ error: "Неизвестная группа" }, { status: 400 })
  const date = params.get("date") ?? new Date().toISOString().slice(0, 10)
  return NextResponse.json(await listWayAgents(group, date))
}
