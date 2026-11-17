import { NextResponse, type NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import {
  SAVED_REPORT_SHOWS,
  createOldSavedReport,
  listOldSavedReports,
  listOldStaticWidgets,
  type SavedReportShow,
} from "@/lib/old-saved-reports-repo"
import { oldSavedReportSchema } from "./schema"

// GET ?show=own|other|all|pattern|static_widget — the tabs of the builder's «Отчеты» / «Виджеты» (Linko's
// main/report_config/?show=…, its templates and its static widgets); without it every report.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const show = request.nextUrl.searchParams.get("show") ?? "all"
  if (!SAVED_REPORT_SHOWS.includes(show as SavedReportShow)) return NextResponse.json({ error: "Неверный параметр" }, { status: 400 })
  if (show === "static_widget") return NextResponse.json(await listOldStaticWidgets())
  return NextResponse.json(await listOldSavedReports(show as Exclude<SavedReportShow, "static_widget">, user))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, oldSavedReportSchema)
  if (parsed.error) return parsed.error

  const report = await createOldSavedReport(
    { name: parsed.data.name, config: parsed.data.config ?? {}, reportType: parsed.data.reportType ?? "table" },
    auth.user,
  )
  return NextResponse.json(report, { status: 201 })
}
