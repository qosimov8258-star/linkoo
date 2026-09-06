import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteSurvey, parseSurveyInput, updateSurvey } from "@/lib/surveys-repo"

const surveySchema = z.object({
  name: z.string().trim().min(1),
  active: z.boolean().optional(),
  organization: z.string().optional(),
  storeType: z.string().optional(),
  comment: z.string().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, surveySchema)
  if (parsed.error) return parsed.error

  const input = parseSurveyInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Название обязательно" }, { status: 400 })

  const survey = (await updateSurvey(id, input))
  if (!survey) return NextResponse.json({ error: "Опросник не найден" }, { status: 404 })
  return NextResponse.json(survey)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteSurvey(id))
  if (!ok) return NextResponse.json({ error: "Опросник не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
