import { NextResponse } from "next/server"

import { deleteClientDebtLimit } from "@/lib/client-debt-limits-repo"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Лимит не найден" }, { status: 404 })
  if (!(await deleteClientDebtLimit(id))) return NextResponse.json({ error: "Лимит не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
