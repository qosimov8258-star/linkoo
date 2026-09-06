import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteSalaryPlan, parseSalaryPlanInput, updateSalaryPlan } from "@/lib/salary-plans-repo"

const salaryPlanSchema = z.object({
  employee: z.string().trim().min(1),
  salary: z.coerce.number().finite().nonnegative(),
  bonus: z.coerce.number().finite().optional(),
  kpi: z.coerce.number().finite().optional(),
  credited: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, salaryPlanSchema)
  if (parsed.error) return parsed.error

  const input = parseSalaryPlanInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Обязательные поля не заполнены" }, { status: 400 })

  const plan = (await updateSalaryPlan(id, input))
  if (!plan) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(plan)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteSalaryPlan(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
