import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteCustomerPayment, updateCustomerPayment, type PaymentPatch } from "@/lib/customer-payments-repo"

type RouteParams = { params: Promise<{ id: string }> }

function parsePatch(body: unknown): PaymentPatch | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const patch: PaymentPatch = {}

  if (typeof value.accepted === "boolean") patch.accepted = value.accepted
  if (typeof value.acceptedAt === "string") patch.acceptedAt = value.acceptedAt
  if (typeof value.kassa === "string") patch.kassa = value.kassa
  if (typeof value.comment === "string") patch.comment = value.comment

  return Object.keys(patch).length > 0 ? patch : null
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const patch = parsePatch(body)
  if (!patch) return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 })

  const payment = updateCustomerPayment(id, patch)
  if (!payment) return NextResponse.json({ error: "Оплата не найдена" }, { status: 404 })
  return NextResponse.json(payment)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const ok = deleteCustomerPayment(id)
  if (!ok) return NextResponse.json({ error: "Оплата не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
