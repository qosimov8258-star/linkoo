import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { copyMonth, recalculate, setApproved, setPlans, setSalaries } from "@/lib/salary-records-repo"

const period = { month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(1970).max(2200) }

const approveSchema = z.object({ ...period, users: z.array(z.coerce.number().int()).min(1), is_approved: z.boolean() })
const plansSchema = z.object({
  ...period,
  users: z
    .array(
      z.object({
        user: z.coerce.number().int(),
        plans: z.array(z.object({ id: z.coerce.number().int(), name: z.string(), planType: z.string().optional(), plan: z.coerce.number().finite().nonnegative() })),
      }),
    )
    .min(1),
})
const salarySchema = z.object({ ...period, users: z.array(z.coerce.number().int()).min(1), salary: z.coerce.number().finite().nonnegative(), currency: z.string().trim().optional() })
const copySchema = z.object({
  from_month: z.coerce.number().int().min(1).max(12),
  from_year: z.coerce.number().int().min(1970).max(2200),
  to_month: z.coerce.number().int().min(1).max(12),
  to_year: z.coerce.number().int().min(1970).max(2200),
  users: z.array(z.coerce.number().int()).default([]),
  copy_indicator: z.boolean().optional(),
  copy_salary: z.boolean().optional(),
})
const recalcSchema = z.object(period)

type RouteParams = { params: Promise<{ action: string }> }

/**
 * POST /api/salary-records/<action>: change-approve ("Зачислить" / "Отменить зачисление"), bulk-plans ("Установить KPI"),
 * bulk-salary ("Установить зарплату"), copy ("Дублировать"), recalculate ("Перерасчет KPI").
 */
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const { action } = await params

  if (action === "change-approve") {
    const parsed = await parseJsonBody(request, approveSchema)
    if (parsed.error) return parsed.error
    return NextResponse.json({ count: await setApproved(parsed.data.month, parsed.data.year, parsed.data.users, parsed.data.is_approved) })
  }
  if (action === "bulk-plans") {
    const parsed = await parseJsonBody(request, plansSchema)
    if (parsed.error) return parsed.error
    const users = parsed.data.users.map((item) => ({ userId: item.user, plans: item.plans.map((plan) => ({ id: plan.id, name: plan.name, planType: plan.planType ?? "", plan: plan.plan })) }))
    return NextResponse.json({ count: await setPlans(parsed.data.month, parsed.data.year, users) })
  }
  if (action === "bulk-salary") {
    const parsed = await parseJsonBody(request, salarySchema)
    if (parsed.error) return parsed.error
    const { month, year, users, salary, currency } = parsed.data
    return NextResponse.json({ count: await setSalaries(month, year, currency ?? "", users.map((userId) => ({ userId, salary }))) })
  }
  if (action === "copy") {
    const parsed = await parseJsonBody(request, copySchema)
    if (parsed.error) return parsed.error
    const d = parsed.data
    const count = await copyMonth({ month: d.from_month, year: d.from_year }, { month: d.to_month, year: d.to_year }, d.users, { copyKpi: Boolean(d.copy_indicator), copySalary: Boolean(d.copy_salary) })
    return NextResponse.json({ count })
  }
  if (action === "recalculate") {
    const parsed = await parseJsonBody(request, recalcSchema)
    if (parsed.error) return parsed.error
    return NextResponse.json({ count: await recalculate(parsed.data.month, parsed.data.year) })
  }
  return NextResponse.json({ error: "Не найдено" }, { status: 404 })
}
