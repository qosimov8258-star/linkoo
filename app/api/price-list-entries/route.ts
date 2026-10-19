import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createPriceListEntry, listPriceListEntries } from "@/lib/price-list-entries-repo"

const priceListEntrySchema = z.object({
  priceList: z.string().trim().min(1),
  product: z.string().trim().min(1),
  cash: z.coerce.number().optional(),
  nonCash: z.coerce.number().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listPriceListEntries()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, priceListEntrySchema)
  if (parsed.error) return parsed.error

  const entry = (await createPriceListEntry({
    priceList: parsed.data.priceList,
    product: parsed.data.product,
    cash: parsed.data.cash ?? 0,
    nonCash: parsed.data.nonCash ?? 0,
  }))
  return NextResponse.json(entry, { status: 201 })
}
