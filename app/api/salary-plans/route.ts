import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createSalaryPlan, listSalaryPlans, salaryPlanListQuery, salaryPlanSchema, SalaryPlanError } from "@/lib/salary-plans-repo"

// GET  /api/salary-plans[?year=YYYY&month=M] → plans of one month (all without a period).
// POST /api/salary-plans (manager+) → "Добавить зарплату": one plan per employee and month.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const query = salaryPlanListQuery.safeParse({ year: params.get("year") || undefined, month: params.get("month") || undefined })
  if (!query.success) return NextResponse.json({ error: "Неверный период", details: query.error.flatten() }, { status: 400 })
  return NextResponse.json(await listSalaryPlans(query.data))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, salaryPlanSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createSalaryPlan(parsed.data), { status: 201 })
  } catch (error) {
    if (error instanceof SalaryPlanError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
