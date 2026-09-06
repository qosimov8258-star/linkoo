import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deletePriceList, updatePriceList } from "@/lib/price-lists-repo"

const priceListSchema = z.object({
  name: z.string().trim().min(1),
  currency: z.string().trim().optional(),
  linkedList: z.string().trim().optional(),
  calcMethod: z.string().trim().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, priceListSchema)
  if (parsed.error) return parsed.error

  const priceList = (await updatePriceList(id, {
    name: parsed.data.name,
    currency: parsed.data.currency || "SUM",
    linkedList: parsed.data.linkedList || "Не указано",
    calcMethod: parsed.data.calcMethod || "Не указано",
  }))
  if (!priceList) return NextResponse.json({ error: "Прайс-лист не найден" }, { status: 404 })
  return NextResponse.json(priceList)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deletePriceList(id))
  if (!ok) return NextResponse.json({ error: "Прайс-лист не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
