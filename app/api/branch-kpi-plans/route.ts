import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { listBranchKpiPlans, saveBranchKpiPlan } from "@/lib/branch-kpi-plans-repo"

const branchKpiPlanSchema = z.object({
  branchId: z.coerce.number().finite(),
  branchName: z.string().trim().min(1),
  period: z.string().trim().min(1),
  planSales: z.coerce.number().catch(0),
  bonusPercent: z.coerce.number().catch(0),
})

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const period = searchParams.get("period") || undefined
  return NextResponse.json((await listBranchKpiPlans(period)))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, branchKpiPlanSchema)
  if (parsed.error) return parsed.error

  const plan = (await saveBranchKpiPlan(parsed.data))
  return NextResponse.json(plan, { status: 201 })
}
