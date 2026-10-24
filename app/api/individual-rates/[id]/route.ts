import { NextResponse } from "next/server"

import { getIndividualRate, updateIndividualRate } from "@/lib/currency-rates-repo"
import { individualRateSchema } from "@/lib/currency-rates-schema"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("viewer")
  if ("error" in auth) return auth.error

  const item = await getIndividualRate(Number((await params).id))
  if (!item) return NextResponse.json({ error: "Индивидуальный курс не найден" }, { status: 404 })
  return NextResponse.json(item)
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, individualRateSchema)
  if (parsed.error) return parsed.error

  const item = await updateIndividualRate(Number((await params).id), parsed.data)
  if (!item) return NextResponse.json({ error: "Индивидуальный курс не найден" }, { status: 404 })
  return NextResponse.json(item)
}
