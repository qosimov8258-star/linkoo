import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { MAX_PRICE } from "@/lib/item-prices"
import { parseCatalogId } from "@/lib/products-api"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { getProductCostInfo, setProductInitialCost } from "@/lib/supplier-incomings-repo"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = () => NextResponse.json({ error: "Товар не найден" }, { status: 404 })

const bodySchema = z.object({
  initialCost: z.coerce.number({ error: "Введите число" }).min(0, "Цена не может быть отрицательной").max(MAX_PRICE, "Слишком большая цена"),
})

/** A refused write of the cost module ({message, status 4xx, fields?}) → its JSON response. */
function clientError(error: unknown): NextResponse | null {
  if (!(error instanceof Error)) return null
  const { status, fields } = error as Error & { status?: unknown; fields?: unknown }
  if (typeof status !== "number" || status < 400 || status > 499) return null
  return NextResponse.json({ error: error.message, ...(fields && typeof fields === "object" ? { fields } : {}) }, { status })
}

/** Initial cost, accepted supplies with running average, current net cost (the one cost of goods). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseCatalogId((await params).id)
  if (!id) return NOT_FOUND()
  const info = await getProductCostInfo(id)
  return info ? NextResponse.json(info) : NOT_FOUND()
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseCatalogId((await params).id)
  if (!id) return NOT_FOUND()
  const parsed = await parseJsonBody(request, bodySchema)
  if (parsed.error) return parsed.error
  try {
    const info = await setProductInitialCost(id, parsed.data.initialCost)
    return info ? NextResponse.json(info) : NOT_FOUND()
  } catch (error) {
    const response = clientError(error)
    if (response) return response
    throw error
  }
}
