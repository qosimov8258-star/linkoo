import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { listSurveyPlans, parseSurveyPlanReplaceInput, replaceSurveyPlanPeriod } from "@/lib/survey-plans-repo"

const surveyPlanReplaceSchema = z.object({
  period: z.string().trim().min(1).max(255, "Не более 255 символов"),
  entries: z.array(z.record(z.string(), z.unknown())).optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listSurveyPlans()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, surveyPlanReplaceSchema)
  if (parsed.error) return parsed.error

  const input = parseSurveyPlanReplaceInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Период обязателен" }, { status: 400 })

  const entries = (await replaceSurveyPlanPeriod(input))
  return NextResponse.json(entries, { status: 201 })
}
