import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { deleteSurvey, surveyBodySchema, surveyErrorResponse, updateSurvey } from "@/lib/surveys-repo"

type RouteParams = { params: Promise<{ id: string }> }

// PUT /api/surveys/[id] — same body and checks as POST /api/surveys.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, surveyBodySchema)
  if (parsed.error) return parsed.error

  try {
    const survey = await updateSurvey(id, parsed.data)
    if (!survey) return NextResponse.json({ error: "Опросник не найден" }, { status: 404 })
    return NextResponse.json(survey)
  } catch (error) {
    const response = surveyErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = await deleteSurvey(id)
  if (!ok) return NextResponse.json({ error: "Опросник не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
