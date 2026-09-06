import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteCostOfGoodsRow, updateCostOfGoodsRow } from "@/lib/cost-of-goods-repo"

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

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, costOfGoodsRowSchema)
  if (parsed.error) return parsed.error

  const date = parsed.data.date || new Date().toISOString()
  const updated = await updateCostOfGoodsRow(id, {
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
  if (!updated) return NextResponse.json({ error: "Строка не найдена" }, { status: 404 })
  return NextResponse.json(updated)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteCostOfGoodsRow(id))
  if (!ok) return NextResponse.json({ error: "Строка не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
