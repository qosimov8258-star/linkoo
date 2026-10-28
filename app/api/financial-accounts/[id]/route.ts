import { NextResponse } from "next/server"
import { z } from "zod"

import { deleteFinancialAccount, updateFinancialAccount } from "@/lib/financial-accounts-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const accountSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, accountSchema)
  if (parsed.error) return parsed.error

  if (!(await updateFinancialAccount(id, parsed.data))) return NextResponse.json({ error: "Финансовый счет не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  if (!(await deleteFinancialAccount(id))) return NextResponse.json({ error: "Финансовый счет не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
