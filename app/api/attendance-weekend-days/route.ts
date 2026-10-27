import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { daysInMonth } from "@/lib/attendance-types"
import { listWeekendDays, replaceWeekendDays } from "@/lib/attendance-weekend-days-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// The older weekend-days API of Посещаемость: month 0..11 (JS Date months) and day numbers.
// GET ?year&month → the month's holiday day numbers (a month never saved = its Sundays plus any
// stored day); POST {year, month, days} replaces the month's whole set (manager +
// settings.manage). The page uses /api/work-attendance/holidays (month 1..12, ISO dates);
// both share lib/attendance-weekend-days-repo.ts.

const YEAR_MONTH = "Требуются year и month"
const DAY_INVALID = "Неверный день месяца"

const yearSchema = z.number({ error: YEAR_MONTH }).int(YEAR_MONTH).min(2000, YEAR_MONTH).max(2100, YEAR_MONTH)
const monthSchema = z.number({ error: YEAR_MONTH }).int(YEAR_MONTH).min(0, YEAR_MONTH).max(11, YEAR_MONTH)

const weekendDaysSchema = z
  .object({
    year: yearSchema,
    month: monthSchema,
    days: z.array(z.number({ error: DAY_INVALID }).int(DAY_INVALID).min(1, DAY_INVALID).max(31, DAY_INVALID), { error: DAY_INVALID }).max(31, DAY_INVALID).optional(),
  })
  .superRefine((value, ctx) => {
    const last = daysInMonth(value.year, value.month + 1)
    value.days?.forEach((day, index) => {
      if (day > last) ctx.addIssue({ code: "custom", message: DAY_INVALID, path: ["days", index] })
    })
  })

/** A query value of digits only ("2026", "9") → number; anything else ("1e20", "0x10", "1.5", "") → NaN. */
function digits(value: string | null): number {
  return value !== null && /^\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const year = yearSchema.safeParse(digits(request.nextUrl.searchParams.get("year")))
  const month = monthSchema.safeParse(digits(request.nextUrl.searchParams.get("month")))
  if (!year.success || !month.success) return NextResponse.json({ error: YEAR_MONTH }, { status: 400 })

  try {
    return NextResponse.json(await listWeekendDays(year.data, month.data))
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, weekendDaysSchema)
  if (parsed.error) return parsed.error

  try {
    const days = await replaceWeekendDays({ year: parsed.data.year, month: parsed.data.month, days: parsed.data.days ?? [], actor: auth.user.displayName })
    return NextResponse.json({ year: parsed.data.year, month: parsed.data.month, days })
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
