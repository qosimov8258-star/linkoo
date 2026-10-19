import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteCashbox, getCashbox, updateCashbox } from "@/lib/cashboxes-repo"

const cashboxSchema = z.object({
  name: z.string().trim().min(1),
  currency: z.string().trim().min(1),
  cashier: z.string().trim().min(1),
  branch: z.string().trim().optional(),
  paymentType: z.string().trim().min(1),
  vansell: z.boolean().optional(),
  orderNumber: z.coerce.number().finite(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const id = Number((await params).id)
  const cashbox = (await getCashbox(id))
  if (!cashbox) return NextResponse.json({ error: "Касса не найдена" }, { status: 404 })
  return NextResponse.json(cashbox)
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, cashboxSchema)
  if (parsed.error) return parsed.error

  const cashbox = await updateCashbox(id, {
    name: parsed.data.name,
    currency: parsed.data.currency,
    cashier: parsed.data.cashier,
    branch: parsed.data.branch ?? "",
    paymentType: parsed.data.paymentType,
    vansell: parsed.data.vansell ?? false,
    orderNumber: parsed.data.orderNumber,
  })
  if (!cashbox) return NextResponse.json({ error: "Касса не найдена" }, { status: 404 })
  return NextResponse.json(cashbox)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteCashbox(id))
  if (!ok) return NextResponse.json({ error: "Касса не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
