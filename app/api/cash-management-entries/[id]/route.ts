import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteCashManagementEntry, updateCashManagementEntry } from "@/lib/cash-management-entries-repo"

const cashManagementEntrySchema = z.object({
  cashboxId: z.coerce.number().finite(),
  description: z.string().optional(),
  category: z.string().optional(),
  clientName: z.string().optional(),
  branch: z.string().optional(),
  organization: z.string().optional(),
  comment: z.string().optional(),
  date: z.string().optional(),
  amount: z.coerce.number().finite(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  const parsed = await parseJsonBody(request, cashManagementEntrySchema)
  if (parsed.error) return parsed.error

  const updated = await updateCashManagementEntry(id, {
    cashboxId: parsed.data.cashboxId,
    description: parsed.data.description ?? "",
    category: parsed.data.category ?? "",
    clientName: parsed.data.clientName ?? "",
    branch: parsed.data.branch ?? "",
    organization: parsed.data.organization ?? "",
    comment: parsed.data.comment ?? "",
    date: parsed.data.date || new Date().toISOString(),
    amount: parsed.data.amount,
  })
  if (!updated) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(updated)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  const ok = (await deleteCashManagementEntry(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
