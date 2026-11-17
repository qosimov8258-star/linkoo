import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { parseBody } from "@/lib/auth-request"
import { fieldWriteScope, requireFieldReader, scopeAllows } from "@/lib/field-activity/actor"
import { planAmount, planErrorResponse, planPeriodOf, planPeriodSchema } from "@/lib/monthly-plans-http"
import { listPlanProducts, planProductOptions, setProductPlans } from "@/lib/monthly-plans-repo"
import { requireRole } from "@/lib/rbac"

// «План на продукты» of an agent's monthly plan: the products with the planned quantity of the month.
//   GET /api/monthly-plans/products?employeeId=&year=&month=[&search=&typeParent=&typeChild=&organizationId=&onlyMml=1&onlyPlanned=1]
//       → { products: PlanProduct[], total }
//   GET /api/monthly-plans/products?options=1  → PlanProductOptions (the filter's product types and organizations)
//   PUT /api/monthly-plans/products  ← { employeeId, year, month, products: [{ productId, amount }] }

const NOT_FOUND = { error: "Сотрудник не найден" }

const saveSchema = z.object({
  ...planPeriodSchema,
  products: z.array(z.object({ productId: z.number().int().positive(), amount: planAmount })).max(5000),
})

const optionalId = (value: string | null) => {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  if (params.get("options")) return NextResponse.json(await planProductOptions())
  const period = planPeriodOf(params)
  if (!period) return NextResponse.json({ error: "Неверное значение" }, { status: 400 })
  if (!scopeAllows(reader.scope, period.employeeId)) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(
    await listPlanProducts({
      ...period,
      search: (params.get("search") ?? "").slice(0, 200),
      typeParent: optionalId(params.get("typeParent")),
      typeChild: optionalId(params.get("typeChild")),
      organizationId: optionalId(params.get("organizationId")),
      onlyMml: params.get("onlyMml") === "1",
      onlyPlanned: params.get("onlyPlanned") === "1",
    }),
  )
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, saveSchema)
  if (parsed.error) return parsed.error
  const write = await fieldWriteScope(auth.user)
  if (write.error) return write.error
  const { employeeId, year, month, products } = parsed.data
  if (!scopeAllows(write.scope, employeeId)) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    return NextResponse.json(await setProductPlans(employeeId, year, month, products))
  } catch (error) {
    return planErrorResponse(error)
  }
}
