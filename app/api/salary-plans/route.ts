import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createSalaryPlan, listSalaryPlans, parseSalaryPlanInput } from "@/lib/salary-plans-repo"

const salaryPlanSchema = z.object({
  employee: z.string().trim().min(1),
  salary: z.coerce.number().finite().nonnegative(),
  bonus: z.coerce.number().finite().optional(),
  kpi: z.coerce.number().finite().optional(),
  credited: z.boolean().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listSalaryPlans()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, salaryPlanSchema)
  if (parsed.error) return parsed.error

  const input = parseSalaryPlanInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Обязательные поля не заполнены" }, { status: 400 })

  const plan = (await createSalaryPlan(input))
  return NextResponse.json(plan, { status: 201 })
}
