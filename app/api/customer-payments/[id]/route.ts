import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteCustomerPayment, updateCustomerPayment } from "@/lib/customer-payments-repo"

type RouteParams = { params: Promise<{ id: string }> }

const paymentPatchSchema = z
  .object({
    accepted: z.boolean().optional(),
    acceptedAt: z.string().optional(),
    kassa: z.string().optional(),
    comment: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Нет данных для обновления" })

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, paymentPatchSchema)
  if (parsed.error) return parsed.error

  const payment = (await updateCustomerPayment(id, parsed.data))
  if (!payment) return NextResponse.json({ error: "Оплата не найдена" }, { status: 404 })
  return NextResponse.json(payment)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteCustomerPayment(id))
  if (!ok) return NextResponse.json({ error: "Оплата не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
