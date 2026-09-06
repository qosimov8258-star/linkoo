import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createPriceList, listPriceLists } from "@/lib/price-lists-repo"

const priceListSchema = z.object({
  name: z.string().trim().min(1),
  currency: z.string().trim().optional(),
  linkedList: z.string().trim().optional(),
  calcMethod: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listPriceLists()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, priceListSchema)
  if (parsed.error) return parsed.error

  const priceList = (await createPriceList({
    name: parsed.data.name,
    currency: parsed.data.currency || "SUM",
    linkedList: parsed.data.linkedList || "Не указано",
    calcMethod: parsed.data.calcMethod || "Не указано",
  }))
  return NextResponse.json(priceList, { status: 201 })
}
