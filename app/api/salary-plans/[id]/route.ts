import { NextResponse } from "next/server"

import { routeId } from "@/lib/finance/api"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteSalaryPlan, salaryPlanSchema, SalaryPlanError, updateSalaryPlan } from "@/lib/salary-plans-repo"

type RouteParams = { params: Promise<{ id: string }> }

/** Edit / "Зачислить" / "Отменить зачисление" of one plan. */
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = routeId((await params).id)
  if (!id) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  const parsed = await parseJsonBody(request, salaryPlanSchema)
  if (parsed.error) return parsed.error

  try {
    const plan = await updateSalaryPlan(id, parsed.data)
    if (!plan) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
    return NextResponse.json(plan)
  } catch (error) {
    if (error instanceof SalaryPlanError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}

/** Deletes a plan that is not credited (a credited one: un-credit first). */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = routeId((await params).id)
  const result = id ? await deleteSalaryPlan(id) : "not_found"
  if (result === "not_found") return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  if (result === "credited") return NextResponse.json({ error: "Сначала отмените зачисление" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
