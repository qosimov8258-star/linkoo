import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment } from "@/lib/validation"
import { deleteReceiptTemplate, getReceiptTemplate, updateReceiptTemplate } from "@/lib/receipt-templates-repo"
import { readReceiptBody } from "../body"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const item = await getReceiptTemplate(id)
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const body = await readReceiptBody(request)
  if (!body) return NextResponse.json({ error: "Неверные данные" }, { status: 400 })
  if (Object.keys(body.fields).length) return NextResponse.json({ error: "Неверные данные", fields: body.fields }, { status: 400 })
  const item = await updateReceiptTemplate(id, body.data)
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  return (await deleteReceiptTemplate(id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}
