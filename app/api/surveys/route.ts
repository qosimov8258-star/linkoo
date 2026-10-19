import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createSurvey, listSurveys, parseSurveyInput } from "@/lib/surveys-repo"

const surveySchema = z.object({
  name: z.string().trim().min(1),
  active: z.boolean().optional(),
  organization: z.string().optional(),
  storeType: z.string().optional(),
  comment: z.string().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listSurveys()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, surveySchema)
  if (parsed.error) return parsed.error

  const input = parseSurveyInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Название обязательно" }, { status: 400 })

  const survey = (await createSurvey(input))
  return NextResponse.json(survey, { status: 201 })
}
