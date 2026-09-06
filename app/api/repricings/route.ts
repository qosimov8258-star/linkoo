import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createRepricing, listRepricings, parseRepricingInput } from "@/lib/repricings-repo"

const repricingSchema = z.object({
  priceListId: z.number().finite(),
  productId: z.number().finite(),
  amount: z.number().optional(),
  currency: z.enum(["SUM", "USD", "Euro"]).optional(),
  status: z.enum(["проведен", "черновик"]).optional(),
  user: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listRepricings()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const user = auth.user

  const parsed = await parseJsonBody(request, repricingSchema)
  if (parsed.error) return parsed.error

  const input = parseRepricingInput(parsed.data, user.displayName)
  if (!input) return NextResponse.json({ error: "Прайс-лист и товар обязательны" }, { status: 400 })

  const repricing = (await createRepricing(input))
  return NextResponse.json(repricing, { status: 201 })
}
