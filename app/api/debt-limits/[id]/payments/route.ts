import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { addDebtLimitPayment } from "@/lib/debt-limits-repo"
import { strictNum } from "@/lib/strict-number"

const paymentSchema = z.object({
  amount: strictNum(z.number().positive()),
  currency: z.enum(["USD", "Euro"]).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, paymentSchema)
  if (parsed.error) return parsed.error

  const client = (await addDebtLimitPayment(id, { amount: parsed.data.amount, currency: parsed.data.currency ?? "SUM" }))
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json(client)
}
