import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { repriceFromIncoming } from "@/lib/supplier-incomings-repo"

const repriceSchema = z.object({
  priceListId: z.coerce.number().int().positive(),
  currency: z.string().trim().default("SUM"),
  comment: z.string().trim().default(""),
  prices: z.array(z.object({ product: z.string().trim().min(1), price: z.coerce.number().finite().min(0) })).min(1),
})

type RouteParams = { params: Promise<{ id: string }> }

/** "Наценка": selling prices calculated from the supply go to a price list. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, repriceSchema)
  if (parsed.error) return parsed.error
  const result = await repriceFromIncoming(Number((await params).id), parsed.data, auth.user.displayName)
  if (result === "not_found") return NextResponse.json({ error: "Приемка не найдена" }, { status: 404 })
  if (result === "price_list_not_found") return NextResponse.json({ error: "Прайс-лист не найден" }, { status: 404 })
  return NextResponse.json(result)
}
