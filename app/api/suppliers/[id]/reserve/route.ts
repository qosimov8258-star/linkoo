import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { addSupplierReserve } from "@/lib/suppliers-repo"
import { MAX_MONEY, MAX_QTY, parseProcurementBody, parseRouteId } from "@/lib/supplier-refs"

const reserveSchema = z.object({
  products: z
    .array(
      z.object({
        product: z.string({ error: "Выберите товар" }).trim().min(1, "Выберите товар").max(500),
        qty: z.coerce.number({ error: "Количество должно быть числом" }).gt(0, "Количество должно быть больше 0").max(MAX_QTY, "Слишком большое количество"),
        price: z.coerce.number({ error: "Цена должна быть числом" }).min(0, "Цена не может быть отрицательной").max(MAX_MONEY, "Слишком большая цена").default(0),
        currency: z.string().trim().max(12).default("SUM"),
      }),
    )
    .min(1, "Добавьте товары")
    .max(1000),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseRouteId((await params).id)
  if (!id) return NextResponse.json({ error: "Поставщик не найден" }, { status: 404 })
  const parsed = await parseProcurementBody(request, reserveSchema)
  if (parsed.error) return parsed.error
  const supplier = await addSupplierReserve(id, parsed.data.products)
  if (!supplier) return NextResponse.json({ error: "Поставщик не найден" }, { status: 404 })
  return NextResponse.json(supplier)
}
