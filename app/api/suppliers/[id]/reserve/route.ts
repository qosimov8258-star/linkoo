import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { getItemCost } from "@/lib/stock/costs"
import { addSupplierReserve, replaceSupplierReserve } from "@/lib/suppliers-repo"
import { MAX_MONEY, MAX_QTY, parseProcurementBody, parseRouteId } from "@/lib/supplier-refs"
import { strictNum } from "@/lib/strict-number"

const reserveSchema = z.object({
  products: z
    .array(
      z.object({
        product: z.string({ error: "Выберите товар" }).trim().min(1, "Выберите товар").max(500),
        qty: strictNum(z.number({ error: "Количество должно быть числом" }).gt(0, "Количество должно быть больше 0").max(MAX_QTY, "Слишком большое количество"), "Количество должно быть числом"),
        price: strictNum(z.number({ error: "Цена должна быть числом" }).min(0, "Цена не может быть отрицательной").max(MAX_MONEY, "Слишком большая цена").default(0), "Цена должна быть числом"),
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

/** «Добавить запас» → «Сохранить»: the dialog's whole list replaces the supplier's reserve (Linko's ProviderReserveForm).
 * `manual` («Указать стоимость в ручную»): each line's price and currency as given; else the product's cost. */
const replaceSchema = z.object({
  manual: z.boolean().default(false),
  products: z
    .array(
      z.object({
        productId: z.number().int().positive().nullable().default(null),
        product: z.string({ error: "Выберите товар" }).trim().min(1, "Выберите товар").max(500),
        unit: z.string().trim().max(50).default(""),
        // Linko keeps a negative amount it was given (a reserve of -4); only zero is refused.
        qty: strictNum(z.number({ error: "Количество должно быть числом" }).min(-MAX_QTY, "Слишком большое количество").max(MAX_QTY, "Слишком большое количество").refine((value) => value !== 0, "Количество должно быть больше 0"), "Количество должно быть числом"),
        price: strictNum(z.number({ error: "Цена должна быть числом" }).min(0, "Цена не может быть отрицательной").max(MAX_MONEY, "Слишком большая цена").default(0), "Цена должна быть числом"),
        currency: z.string().trim().max(12).default("SUM"),
      }),
    )
    .max(1000),
})

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseRouteId((await params).id)
  if (!id) return NextResponse.json({ error: "Поставщик не найден" }, { status: 404 })
  const parsed = await parseProcurementBody(request, replaceSchema)
  if (parsed.error) return parsed.error
  const { manual, products } = parsed.data
  const supplier = await replaceSupplierReserve(id, products, manual, async (line) => (line.productId ? await getItemCost(`product:${line.productId}`) : 0))
  if (!supplier) return NextResponse.json({ error: "Поставщик не найден" }, { status: 404 })
  return NextResponse.json(supplier)
}
