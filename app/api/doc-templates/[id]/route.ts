import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteDocTemplate, getDocTemplate, updateDocTemplate, validateDocTemplate } from "@/lib/doc-templates-repo"
import { requireRole } from "@/lib/rbac"
import { readDocTemplateBody } from "../body"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const item = await getDocTemplate(Number((await params).id))
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const body = await readDocTemplateBody(request)
  const fields = validateDocTemplate(body)
  if (Object.keys(fields).length) return NextResponse.json({ error: "Неверные данные", fields }, { status: 400 })
  const item = await updateDocTemplate(Number((await params).id), { name: body.name!, keyName: body.keyName!, isActive: Boolean(body.isActive), html: body.html! })
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  return (await deleteDocTemplate(Number((await params).id))) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}
