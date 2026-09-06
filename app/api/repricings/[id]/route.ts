import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteRepricing, parseRepricingInput, updateRepricing } from "@/lib/repricings-repo"

const repricingSchema = z.object({
  priceListId: z.number().finite(),
  productId: z.number().finite(),
  amount: z.number().optional(),
  currency: z.enum(["SUM", "USD", "Euro"]).optional(),
  status: z.enum(["проведен", "черновик"]).optional(),
  user: z.string().trim().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const user = auth.user

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, repricingSchema)
  if (parsed.error) return parsed.error

  const input = parseRepricingInput(parsed.data, user.displayName)
  if (!input) return NextResponse.json({ error: "Прайс-лист и товар обязательны" }, { status: 400 })

  const repricing = (await updateRepricing(id, input))
  if (!repricing) return NextResponse.json({ error: "Переоценка не найдена" }, { status: 404 })
  return NextResponse.json(repricing)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteRepricing(id))
  if (!ok) return NextResponse.json({ error: "Переоценка не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
