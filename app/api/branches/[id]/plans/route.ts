import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createBranchPlan, listBranchPlans } from "@/lib/branches-repo"

const planSchema = z.object({
  weight: z.string().trim().max(50).default(""),
  amount: z.string().trim().max(50).default(""),
  price: z.string().trim().max(50).default(""),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = Number((await params).id)
  return NextResponse.json(await listBranchPlans(id))
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, planSchema)
  if (parsed.error) return parsed.error

  const plan = await createBranchPlan(id, parsed.data)
  if (!plan) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })
  return NextResponse.json(plan, { status: 201 })
}
