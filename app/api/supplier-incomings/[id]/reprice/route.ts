import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { RepricingError } from "@/lib/repricings-read"
import { repriceFromIncoming } from "@/lib/supplier-incomings-repo"
import { incomingNotFound } from "@/lib/supplier-incomings-api"
import { MAX_MONEY, parseProcurementBody, parseRouteId } from "@/lib/supplier-refs"

const repriceSchema = z.object({
  priceListId: z.coerce.number({ error: "Выберите прайс-лист" }).int().positive("Выберите прайс-лист").max(2_147_483_647),
  currency: z.string().trim().max(12).default("SUM"),
  comment: z.string().trim().max(2000).default(""),
  prices: z
    .array(
      z.object({
        product: z.string().trim().min(1, "Выберите товар").max(500),
        price: z.coerce.number({ error: "Цена должна быть числом" }).min(0, "Цена не может быть отрицательной").max(MAX_MONEY, "Слишком большая цена"),
      }),
    )
    .min(1, "Добавьте товары")
    .max(1000),
})

type RouteParams = { params: Promise<{ id: string }> }

/** "Наценка": selling prices calculated from the supply go to a price list. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseRouteId((await params).id)
  if (!id) return incomingNotFound()
  const parsed = await parseProcurementBody(request, repriceSchema)
  if (parsed.error) return parsed.error
  let result: Awaited<ReturnType<typeof repriceFromIncoming>>
  try {
    result = await repriceFromIncoming(id, parsed.data, auth.user.displayName)
  } catch (error) {
    if (error instanceof RepricingError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
  if (result === "not_found") return incomingNotFound()
  if (result === "price_list_not_found") return NextResponse.json({ error: "Прайс-лист не найден" }, { status: 404 })
  return NextResponse.json(result)
}
