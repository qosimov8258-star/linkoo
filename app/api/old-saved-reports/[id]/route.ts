import { NextResponse } from "next/server"

import { parseId } from "@/lib/auth-request"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteOldSavedReport, updateOldSavedReport } from "@/lib/old-saved-reports-repo"
import { oldSavedReportSchema } from "../schema"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Отчет не найден" }

// PUT — Linko's «Изменение таблицы»: the report takes the builder's current settings with the new name.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, oldSavedReportSchema)
  if (parsed.error) return parsed.error

  const report = await updateOldSavedReport(id, { name: parsed.data.name, config: parsed.data.config ?? {}, reportType: parsed.data.reportType ?? "table" })
  if (!report) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(report)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id || !(await deleteOldSavedReport(id))) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json({ ok: true })
}
