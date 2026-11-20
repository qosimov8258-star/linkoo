import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createSurvey, listSurveys, surveyBodySchema, surveyErrorResponse } from "@/lib/questionnaires-repo"

// GET /api/surveys — every survey with its questions (lib/questionnaires-repo.ts).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listSurveys())
}

// POST /api/surveys {name, active?, organizationId?, clientTypeId?, comment?, orderNo?, flags?, questions?} — a given
// organization must exist (400 "Организация не найдена"); a given client type must exist (400 "Тип клиента не
// найден"). The Excel import may send {organization, storeType} names instead.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, surveyBodySchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createSurvey(parsed.data), { status: 201 })
  } catch (error) {
    const response = surveyErrorResponse(error)
    if (response) return response
    throw error
  }
}
