import { NextResponse } from "next/server"
import { z } from "zod"

import { parseId } from "@/lib/auth-request"
import { createBranchPlan, listBranchPlans } from "@/lib/branches-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { NOT_A_NUMBER, strictNumber } from "@/lib/strict-number"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

const MAX_QUANTITY = 1e9
const MAX_MONEY = 1e13
const QUANTITY_RANGE = "Количество должно быть больше 0 и не больше 1 000 000 000"

/** A plan number typed in the form: a JSON number or a plain decimal text ("1 500,5" too); "" / null = not set. */
const planNumber = (schema: z.ZodNumber) =>
  z.preprocess((value, ctx) => {
    if (value === undefined || value === null) return null
    if (typeof value === "string" && !value.trim()) return null
    const number = strictNumber(value, { locale: true })
    if (Number.isNaN(number)) {
      ctx.issues.push({ code: "custom", message: NOT_A_NUMBER, input: value })
      return z.NEVER
    }
    return number
  }, schema.nullable())

// Weight and quantity: 0 < x ≤ 1e9; price: 0 ≤ x ≤ 1e13. At least one of them is given.
const planSchema = z
  .object({
    weight: planNumber(z.number().finite().gt(0, { error: QUANTITY_RANGE }).max(MAX_QUANTITY, { error: QUANTITY_RANGE })),
    amount: planNumber(z.number().finite().gt(0, { error: QUANTITY_RANGE }).max(MAX_QUANTITY, { error: QUANTITY_RANGE })),
    price: planNumber(z.number().finite().min(0, { error: "Не может быть отрицательным" }).max(MAX_MONEY, { error: "Слишком большое значение" })),
  })
  .refine((plan) => plan.weight !== null || plan.amount !== null || plan.price !== null, { error: "Обязательное поле", path: ["weight"] })

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Филиал не найден" }

export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(await listBranchPlans(id))
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, planSchema)
  if (parsed.error) return parsed.error

  const plan = await createBranchPlan(id, {
    weight: parsed.data.weight ?? null,
    amount: parsed.data.amount ?? null,
    price: parsed.data.price ?? null,
  })
  if (!plan) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(plan, { status: 201 })
}
