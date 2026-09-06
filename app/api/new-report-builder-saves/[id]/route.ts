import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { deleteNewReportBuilderSave } from "@/lib/new-report-builder-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteNewReportBuilderSave(id))
  if (!ok) return NextResponse.json({ error: "Отчет не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
