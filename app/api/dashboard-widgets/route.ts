import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { listDashboardWidgets, saveDashboardWidget, type DashboardWidgetInput } from "@/lib/dashboard-widgets-repo"

const dashboardWidgetSchema = z.object({
  reportSlug: z.string().trim().min(1),
  reportLabel: z.string().trim().optional(),
  dashboard: z.string().trim().optional(),
  visibility: z.string().trim().optional(),
  employeeIds: z.array(z.number()).optional(),
  accessRightIds: z.array(z.number()).optional(),
})

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const reportSlug = request.nextUrl.searchParams.get("reportSlug") ?? undefined
  return NextResponse.json((await listDashboardWidgets(reportSlug)))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, dashboardWidgetSchema)
  if (parsed.error) return parsed.error

  const input: DashboardWidgetInput = {
    reportSlug: parsed.data.reportSlug,
    reportLabel: parsed.data.reportLabel ?? "",
    dashboard: parsed.data.dashboard || "Основной дашборд",
    visibility: parsed.data.visibility || "all",
    employeeIds: parsed.data.employeeIds ?? [],
    accessRightIds: parsed.data.accessRightIds ?? [],
  }

  const widget = (await saveDashboardWidget(input))
  return NextResponse.json(widget, { status: 201 })
}
