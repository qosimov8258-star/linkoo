import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createOldSavedReport, listOldSavedReports } from "@/lib/old-saved-reports-repo"

const oldSavedReportSchema = z.object({
  name: z.string().trim().min(1),
  config: z.unknown().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listOldSavedReports()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, oldSavedReportSchema)
  if (parsed.error) return parsed.error

  const report = (await createOldSavedReport({
    name: parsed.data.name,
    config: parsed.data.config ?? {},
  }))
  return NextResponse.json(report, { status: 201 })
}
