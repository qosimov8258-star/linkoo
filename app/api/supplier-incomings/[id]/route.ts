import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { applyIncomingMarkup, cancelIncoming, deleteIncoming, parseIncomingInput, updateIncoming } from "@/lib/supplier-incomings-repo"

const supplierIncomingSchema = z.object({
  supplier: z.string().trim().min(1),
  warehouse: z.string().trim().min(1),
  branch: z.string().optional(),
  organization: z.string().optional(),
  paymentType: z.string().optional(),
  date: z.string().optional(),
  contractNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  comment: z.string().optional(),
  items: z.array(z.record(z.string(), z.unknown())).min(1),
})

const supplierIncomingPatchSchema = z.object({
  action: z.string(),
  percent: z.union([z.number(), z.string()]).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, supplierIncomingPatchSchema)
  if (parsed.error) return parsed.error

  const { action, percent } = parsed.data
  if (action === "cancel") {
    const incoming = (await cancelIncoming(id))
    if (!incoming) return NextResponse.json({ error: "Приемка не найдена" }, { status: 404 })
    return NextResponse.json(incoming)
  }
  if (action === "markup") {
    const percentValue = Number(percent)
    if (!Number.isFinite(percentValue)) return NextResponse.json({ error: "Некорректный процент" }, { status: 400 })
    const incoming = (await applyIncomingMarkup(id, percentValue))
    if (!incoming) return NextResponse.json({ error: "Приемка не найдена" }, { status: 404 })
    return NextResponse.json(incoming)
  }
  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 })
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, supplierIncomingSchema)
  if (parsed.error) return parsed.error

  const input = parseIncomingInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Поставщик, склад и товары обязательны" }, { status: 400 })

  const incoming = (await updateIncoming(id, input))
  if (!incoming) return NextResponse.json({ error: "Приемка не найдена" }, { status: 404 })
  return NextResponse.json(incoming)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteIncoming(id))
  if (!ok) return NextResponse.json({ error: "Приемка не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
