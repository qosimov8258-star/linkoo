import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { getProductCostInfo, setProductInitialCost } from "@/lib/supplier-incomings-repo"

type RouteParams = { params: Promise<{ id: string }> }

/** Initial cost, accepted supplies with running average, current net cost. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const info = await getProductCostInfo(Number((await params).id))
  return info ? NextResponse.json(info) : NextResponse.json({ error: "Товар не найден" }, { status: 404 })
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, z.object({ initialCost: z.coerce.number().finite().min(0) }))
  if (parsed.error) return parsed.error
  const info = await setProductInitialCost(Number((await params).id), parsed.data.initialCost)
  return info ? NextResponse.json(info) : NextResponse.json({ error: "Товар не найден" }, { status: 404 })
}
