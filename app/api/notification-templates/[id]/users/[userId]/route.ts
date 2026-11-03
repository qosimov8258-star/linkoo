import { NextResponse } from "next/server"

import { removeNotificationTemplateUser } from "@/lib/notification-templates-repo"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment } from "@/lib/validation"

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const { id: rawId, userId: rawUserId } = await params
  const id = parseIdSegment(rawId)
  const userId = parseIdSegment(rawUserId)
  if (!id || !userId) return invalidIdResponse()
  if (!(await removeNotificationTemplateUser(id, userId))) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
