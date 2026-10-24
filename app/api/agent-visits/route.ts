import { NextRequest, NextResponse } from "next/server"

import { getAttendanceMonth, getRoutesBoard, getVisitStats, getWorkTime, isoDay, listClientVisits } from "@/lib/agent-visits-repo"
import { getCurrentUser } from "@/lib/current-user"

/**
 * GET /api/agent-visits?date=YYYY-MM-DD → the route board (problem / working agents);
 * GET /api/agent-visits?view=stats&begin=…&end=… → per-agent visit statistics of a range;
 * GET /api/agent-visits?view=attendance&year=Y&month=M0 → clock-in verdicts per agent and day;
 * GET /api/agent-visits?view=work-time&begin=…&end=… → per agent and day working-time facts;
 * GET /api/agent-visits?view=client&client=NAME → a client's visits that did not end in an order.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = request.nextUrl.searchParams
  if (params.get("view") === "attendance") {
    const now = new Date()
    return NextResponse.json(await getAttendanceMonth(Number(params.get("year")) || now.getFullYear(), Number(params.get("month")) || (params.get("month") === "0" ? 0 : now.getMonth())))
  }
  if (params.get("view") === "work-time") {
    const today = isoDay(new Date())
    return NextResponse.json(await getWorkTime(params.get("begin") ?? today, params.get("end") ?? today))
  }
  if (params.get("view") === "client") return NextResponse.json(await listClientVisits(params.get("client") ?? ""))
  if (params.get("view") === "stats") {
    const today = isoDay(new Date())
    return NextResponse.json(await getVisitStats(params.get("begin") ?? today, params.get("end") ?? today))
  }
  const date = request.nextUrl.searchParams.get("date") ?? isoDay(new Date())
  return NextResponse.json(await getRoutesBoard(date))
}
