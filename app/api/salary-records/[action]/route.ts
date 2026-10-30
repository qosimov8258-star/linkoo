import { NextResponse } from "next/server"
import { z } from "zod"

import { dbErrorResponse } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { SalaryInputError, copyMonth, recalculate, setApproved, setPlans, setSalaries } from "@/lib/salary-records-repo"
import { dbId, strictNum } from "@/lib/strict-number"
import { parseJsonBody } from "@/lib/validation"

const BAD = "Неверные данные"
const MAX_MONEY = 1e13
const monthField = () => strictNum(z.number({ error: BAD }).int(BAD).min(1, BAD).max(12, BAD), BAD)
const yearField = () => strictNum(z.number({ error: BAD }).int(BAD).min(2000, BAD).max(2100, BAD), BAD)
const userIds = () => z.array(dbId("Выберите сотрудника"), { error: "Выберите сотрудника" }).max(5000, "Слишком много значений")
const money = () => strictNum(z.number({ error: "Неверная сумма" }).min(0, "Сумма не может быть отрицательной").max(MAX_MONEY, "Слишком большая сумма"), "Неверная сумма")
const period = { month: monthField(), year: yearField() }

const approveSchema = z.object({ ...period, users: userIds().min(1, "Выберите сотрудника"), is_approved: z.boolean({ error: BAD }) })
const plansSchema = z.object({
  ...period,
  users: z
    .array(
      z.object({
        user: dbId("Выберите сотрудника"),
        plans: z
          .array(
            z.object({
              id: dbId(BAD),
              name: z.string({ error: BAD }).max(500, BAD),
              planType: z.string({ error: BAD }).max(100, BAD).optional(),
              plan: strictNum(z.number({ error: "Неверное значение" }).min(0, "Неверное значение").max(MAX_MONEY, "Неверное значение"), "Неверное значение"),
            }),
          )
          .max(500, "Слишком много значений"),
      }),
      { error: "Выберите сотрудника" },
    )
    .min(1, "Выберите сотрудника")
    .max(5000, "Слишком много значений"),
})
const salarySchema = z.object({
  ...period,
  users: userIds().min(1, "Выберите сотрудника"),
  salary: money(),
  currency: z.string({ error: "Неизвестная валюта" }).trim().max(100, "Неизвестная валюта").optional(),
})
const copySchema = z.object({
  from_month: monthField(),
  from_year: yearField(),
  to_month: monthField(),
  to_year: yearField(),
  users: userIds().default([]),
  copy_indicator: z.boolean({ error: BAD }).optional(),
  copy_salary: z.boolean({ error: BAD }).optional(),
})
const recalcSchema = z.object(period)

type RouteParams = { params: Promise<{ action: string }> }

/**
 * POST /api/salary-records/<action>: change-approve ("Зачислить" / "Отменить зачисление"), bulk-plans ("Установить KPI"),
 * bulk-salary ("Установить зарплату"), copy ("Дублировать"), recalculate ("Перерасчет KPI").
 */
export async function POST(request: Request, context: RouteParams) {
  try {
    return await run(request, context)
  } catch (error) {
    if (error instanceof SalaryInputError) return NextResponse.json({ error: error.message }, { status: 400 })
    const response = dbErrorResponse(error)
    if (response) return response
    throw error
  }
}

async function run(request: Request, { params }: RouteParams) {
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
