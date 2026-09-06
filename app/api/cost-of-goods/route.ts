import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createCostOfGoodsRow, listCostOfGoodsRows } from "@/lib/cost-of-goods-repo"

const costOfGoodsRowSchema = z.object({
  name: z.string().trim().min(1),
  warehouse: z.string().optional(),
  date: z.string().optional(),
  avgCost: z.coerce.number().catch(0),
  cost: z.coerce.number().catch(0),
  passed: z.boolean().optional(),
  supplyNumber: z.string().optional(),
  calculatedBalance: z.coerce.number().catch(0),
  actualBalance: z.coerce.number().catch(0),
  totalRevaluation: z.coerce.number().catch(0),
  lastCheckTime: z.string().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listCostOfGoodsRows()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, costOfGoodsRowSchema)
  if (parsed.error) return parsed.error

  const date = parsed.data.date || new Date().toISOString()
  const created = await createCostOfGoodsRow({
    name: parsed.data.name,
    warehouse: parsed.data.warehouse ?? "",
    date,
    avgCost: parsed.data.avgCost,
    cost: parsed.data.cost,
    passed: parsed.data.passed ?? false,
    supplyNumber: parsed.data.supplyNumber ?? "",
    calculatedBalance: parsed.data.calculatedBalance,
    actualBalance: parsed.data.actualBalance,
    totalRevaluation: parsed.data.totalRevaluation,
    lastCheckTime: parsed.data.lastCheckTime || date,
  })
  return NextResponse.json(created, { status: 201 })
}
