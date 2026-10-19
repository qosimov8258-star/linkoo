import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createPriceListEntry, listPriceListEntries } from "@/lib/price-list-entries-repo"

const priceListEntrySchema = z.object({
  priceList: z.string().trim().min(1),
  product: z.string().trim().min(1),
  cash: z.coerce.number().min(0).optional(),
  nonCash: z.coerce.number().min(0).optional(),
})

// GET /api/price-list-entries — [{id, priceList, product, cash, nonCash}] derived from the item
// prices (price analysis reads it).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listPriceListEntries())
}

// POST /api/price-list-entries — writes one price into the item (lib/item-prices.ts).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, priceListEntrySchema)
  if (parsed.error) return parsed.error

  const cash = parsed.data.cash ?? 0
  const entry = await createPriceListEntry({ priceList: parsed.data.priceList, product: parsed.data.product, cash, nonCash: parsed.data.nonCash ?? cash })
  if (entry === "price_list_not_found") return NextResponse.json({ error: "Прайс-лист не найден" }, { status: 400 })
  if (!entry) return NextResponse.json({ error: "Товар не найден" }, { status: 400 })
  return NextResponse.json(entry, { status: 201 })
}
