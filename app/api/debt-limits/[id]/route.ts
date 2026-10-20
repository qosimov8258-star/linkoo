import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { deleteDebtLimitClient } from "@/lib/debt-limits-repo"
import { invalidIdResponse, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = (await deleteDebtLimitClient(id))
  if (!ok) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
