import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { setDebtLimit } from "@/lib/debt-limits-repo"
import { strictNum } from "@/lib/strict-number"

const debtLimitInputSchema = z.object({
  unlimited: z.boolean().optional(),
  currency: z.enum(["USD", "Euro"]).optional(),
  limit: strictNum(z.number().optional()),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, debtLimitInputSchema)
  if (parsed.error) return parsed.error

  const client = (await setDebtLimit(id, {
    unlimited: parsed.data.unlimited === true,
    limit: parsed.data.limit ?? 0,
    currency: parsed.data.currency ?? "SUM",
  }))
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json(client)
}
