import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createNewReportBuilderSave, listNewReportBuilderSaves } from "@/lib/new-report-builder-repo"

const newReportBuilderSaveSchema = z.object({
  name: z.string().trim().min(1),
  reportType: z.string().trim().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listNewReportBuilderSaves()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, newReportBuilderSaveSchema)
  if (parsed.error) return parsed.error

  const save = (await createNewReportBuilderSave({
    name: parsed.data.name,
    reportType: parsed.data.reportType ?? "",
    config: parsed.data.config ?? {},
  }))
  return NextResponse.json(save, { status: 201 })
}
