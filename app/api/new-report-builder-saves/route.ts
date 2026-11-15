import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { builderViewer, createNewReportBuilderSave, listNewReportBuilderSaves } from "@/lib/new-report-builder-repo"

const newReportBuilderSaveSchema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  reportType: z.string().trim().max(255, "Не более 255 символов").optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

// GET /api/new-report-builder-saves — the saved constructor reports the caller may see (their own, the
// unrestricted ones and the ones shared with their account or access right; an administrator sees all).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listNewReportBuilderSaves(builderViewer(user)))
}

// POST /api/new-report-builder-saves {name, reportType, config} — «СОХРАНИТЬ ТАБЛИЦУ»; the caller is its author.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, newReportBuilderSaveSchema)
  if (parsed.error) return parsed.error

  const save = await createNewReportBuilderSave(
    {
      name: parsed.data.name,
      reportType: parsed.data.reportType ?? "",
      config: parsed.data.config ?? {},
    },
    builderViewer(auth.user),
  )
  return NextResponse.json(save, { status: 201 })
}
