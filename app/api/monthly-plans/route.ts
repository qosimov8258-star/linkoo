import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { parseBody } from "@/lib/auth-request"
import { fieldWriteScope, requireFieldReader, scopeAllows } from "@/lib/field-activity/actor"
import { planAmount, planErrorResponse, planPeriodOf, planPeriodSchema } from "@/lib/monthly-plans-http"
import { getMonthlyPlan, setOrganizationPlans } from "@/lib/monthly-plans-repo"
import { requireRole } from "@/lib/rbac"

// An agent's monthly sales plan (Анализ маршрутов → the agent → «план продаж», Linko's sales/monthly_plan).
//   GET /api/monthly-plans?employeeId=&year=&month=  → MonthlyPlan (organizations with their sales sum / АКБ)
//   PUT /api/monthly-plans  ← { employeeId, year, month, organizations: [{ organizationId, summa, akb }] }

const NOT_FOUND = { error: "Сотрудник не найден" }

const saveSchema = z.object({
  ...planPeriodSchema,
  organizations: z.array(z.object({ organizationId: z.number().int().positive(), summa: planAmount, akb: planAmount })).max(1000),
})

export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const period = planPeriodOf(request.nextUrl.searchParams)
  if (!period) return NextResponse.json({ error: "Неверное значение" }, { status: 400 })
  if (!scopeAllows(reader.scope, period.employeeId)) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(await getMonthlyPlan(period.employeeId, period.year, period.month))
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, saveSchema)
  if (parsed.error) return parsed.error
  const write = await fieldWriteScope(auth.user)
  if (write.error) return write.error
  const { employeeId, year, month, organizations } = parsed.data
  if (!scopeAllows(write.scope, employeeId)) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    return NextResponse.json(await setOrganizationPlans(employeeId, year, month, organizations))
  } catch (error) {
    return planErrorResponse(error)
  }
}
