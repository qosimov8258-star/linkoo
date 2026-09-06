import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createSavedReport, listSavedReports, parseSavedReportInput } from "@/lib/saved-reports-repo"

const savedReportSchema = z.object({
  name: z.string().trim().min(1),
  config: z.unknown().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listSavedReports()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, savedReportSchema)
  if (parsed.error) return parsed.error

  const input = parseSavedReportInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование отчёта обязательно" }, { status: 400 })

  const report = (await createSavedReport(input))
  return NextResponse.json(report, { status: 201 })
}
