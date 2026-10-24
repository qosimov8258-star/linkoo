import { NextResponse } from "next/server"

import { DOC_TEMPLATE_ORDERINGS } from "@/components/analytics/doc-templates-data"
import { getCurrentUser } from "@/lib/current-user"
import { dictionaryListQuery } from "@/lib/dictionaries-schema"
import { createDocTemplate, listDocTemplates, validateDocTemplate } from "@/lib/doc-templates-repo"
import { requireRole } from "@/lib/rbac"
import { readDocTemplateBody } from "./body"

// GET /api/doc-templates?page&pageSize&search&ordering — demo saas/template/: {count, results}.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const query = dictionaryListQuery(new URL(request.url).searchParams, DOC_TEMPLATE_ORDERINGS)
  if (query instanceof NextResponse) return query
  return NextResponse.json(await listDocTemplates(query))
}

// POST {name, keyName, isActive, html}; a missing field answers {error, fields: {name|key_name|html}}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const body = await readDocTemplateBody(request)
  const fields = validateDocTemplate(body)
  if (Object.keys(fields).length) return NextResponse.json({ error: "Неверные данные", fields }, { status: 400 })
  return NextResponse.json(await createDocTemplate({ name: body.name!, keyName: body.keyName!, isActive: Boolean(body.isActive), html: body.html! }), { status: 201 })
}
