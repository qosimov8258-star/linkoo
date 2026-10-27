import { NextRequest, NextResponse } from "next/server"

import { parseDay } from "@/lib/attendance-api"
import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { dayDetail } from "@/lib/attendance-repo"
import { mobileCheckInSchema } from "@/lib/check-ins-schema"
import { recordCheckIn } from "@/lib/check-ins-repo"
import { getCurrentUser, type CurrentUser } from "@/lib/current-user"
import { todayIso } from "@/lib/finance/dates"
import { PASSWORD_CHANGE_REQUIRED, PASSWORD_CHANGE_REQUIRED_CODE } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// The work check-in API of the mobile app (Посещаемость). The app signs in like the web
// (POST /api/auth/login, session cookie) as an account linked to an employee
// (Права доступа → Пользователи → Сотрудник); every call acts for that employee only.
//
//   GET  /api/mobile/check-ins[?date=YYYY-MM-DD]  → the day's status and events (default today)
//   POST /api/mobile/check-ins {kind: "in"|"out", at?: ISO date-time with offset (default now),
//        lat?, lng?, accuracy? (m), place?, comment?, deviceId?, idempotencyKey}
//        → 201 {checkIn, duplicate: false, day} | 200 {checkIn, duplicate: true, day} for a retry
//
// Checking in is self-service: it needs no access-right permission (an employee restricted
// to the stock or the cash desk still records his own working day), only a signed-in,
// non-viewer account (viewers are refused at the edge) whose employee is active. Validation
// and idempotency: lib/check-ins-repo.ts.

const NOT_LINKED = "Учетная запись не привязана к сотруднику"

/** The signed-in account and its employee, or the refusal. */
async function employeeAccount(): Promise<{ user: CurrentUser; employeeId: number } | { error: NextResponse }> {
  const user = await getCurrentUser()
  if (!user) return { error: notSignedInResponse() }
  if (user.mustChangePassword) {
    return { error: NextResponse.json({ error: PASSWORD_CHANGE_REQUIRED, code: PASSWORD_CHANGE_REQUIRED_CODE }, { status: 403 }) }
  }
  if (!user.employeeId) return { error: NextResponse.json({ error: NOT_LINKED, code: "employeeNotLinked" }, { status: 403 }) }
  return { user, employeeId: user.employeeId }
}

async function ownDay(employeeId: number, date: string) {
  const detail = await dayDetail(employeeId, date)
  const last = detail.checkIns.at(-1)
  return {
    employee: { id: detail.employee.id, name: detail.employee.name },
    date: detail.date,
    holiday: detail.holiday,
    lateAfter: detail.lateAfter,
    day: detail.day,
    checkedIn: last?.kind === "in",
    checkIns: detail.checkIns,
  }
}

export async function GET(request: NextRequest) {
  const account = await employeeAccount()
  if ("error" in account) return account.error
  const raw = request.nextUrl.searchParams.get("date")
  const day = raw ? parseDay(raw, false) : ({ ok: true, date: todayIso() } as const)
  if (!day.ok) return NextResponse.json({ error: day.error, field: "date" }, { status: 400 })
  try {
    return NextResponse.json(await ownDay(account.employeeId, day.date))
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function POST(request: Request) {
  const account = await employeeAccount()
  if ("error" in account) return account.error
  if (account.user.role === "viewer") return NextResponse.json({ error: "У вас нет прав на это действие" }, { status: 403 })
  const parsed = await parseJsonBody(request, mobileCheckInSchema)
  if (parsed.error) return parsed.error
  try {
    const result = await recordCheckIn({
      ...parsed.data,
      employeeId: account.employeeId,
      userId: account.user.id,
      source: "mobile",
      actor: account.user.displayName,
    })
    return NextResponse.json({ ...result, day: await ownDay(account.employeeId, result.checkIn.date) }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
