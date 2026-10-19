import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { listWeekendDays, replaceWeekendDays } from "@/lib/attendance-weekend-days-repo"

const weekendDaysSchema = z.object({
  year: z.number().finite(),
  month: z.number().finite().min(0).max(11),
  days: z.array(z.number()).optional(),
})

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const year = Number(request.nextUrl.searchParams.get("year"))
  const month = Number(request.nextUrl.searchParams.get("month"))
  if (!Number.isFinite(year) || !Number.isFinite(month)) return NextResponse.json({ error: "Требуются year и month" }, { status: 400 })

  return NextResponse.json((await listWeekendDays(year, month)))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, weekendDaysSchema)
  if (parsed.error) return parsed.error

  const input = {
    year: parsed.data.year,
    month: parsed.data.month,
    days: (parsed.data.days ?? []).filter((item) => Number.isFinite(item) && item >= 1 && item <= 31),
  }
  const days = (await replaceWeekendDays(input))
  return NextResponse.json({ year: input.year, month: input.month, days })
}
