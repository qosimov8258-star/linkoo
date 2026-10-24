import { NextResponse } from "next/server"
import { z } from "zod"

import { getRecalcDays, recalcAttendance } from "@/lib/agent-visits-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(0).max(11) })

// POST /api/attendance-recalc { year, month } — "Перерасчет" of the attendance widget / "Посещения на работу".
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return NextResponse.json(await recalcAttendance(parsed.data.year, parsed.data.month))
}

// GET /api/attendance-recalc?year=2026&month=9 — days of that month covered by the snapshot.
export async function GET(request: Request) {
  const auth = await requireRole("viewer")
  if ("error" in auth) return auth.error
  const params = new URL(request.url).searchParams
  const year = Number(params.get("year"))
  const month = Number(params.get("month"))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) return NextResponse.json({ error: "year/month" }, { status: 400 })
  return NextResponse.json(await getRecalcDays(year, month))
}
