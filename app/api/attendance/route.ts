import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { ATTENDANCE_TYPES, getAttendance, recalcCells, setAttendance } from "@/lib/attendance-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// GET /api/attendance?year=2026&month=10[&branch=14,15] → { holidays, users } like the reference's staff/attendance.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const p = request.nextUrl.searchParams
  const year = Number(p.get("year"))
  const month = Number(p.get("month"))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "year/month" }, { status: 400 })
  const branch = (p.get("branch") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0)
  return NextResponse.json(await getAttendance(year, month, branch))
}

const schema = z.object({
  action: z.enum(["set", "recalc"]),
  employeeIds: z.array(z.number().int()).optional(),
  branch: z.array(z.number().int()).optional(),
  search: z.string().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(ATTENDANCE_TYPES as [string, ...string[]]).optional(),
  comment: z.string().max(500).optional(),
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
})

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const d = parsed.data
  if (d.action === "set") {
    if (!d.date || !d.type || !d.employeeIds?.length) return NextResponse.json({ error: "date/type" }, { status: 400 })
    await setAttendance(d.employeeIds, d.date, d.type as never, d.comment ?? "")
    return NextResponse.json({ ok: true })
  }
  if (!d.year || !d.month) return NextResponse.json({ error: "year/month" }, { status: 400 })
  return NextResponse.json({ ok: true, cells: await recalcCells(d.year, d.month, d.branch ?? [], d.search ?? "") })
}
