import { NextResponse } from "next/server"

import { removeNotificationTemplateUser } from "@/lib/notification-templates-repo"
import { requireRole } from "@/lib/rbac"

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const { id, userId } = await params
  if (!(await removeNotificationTemplateUser(Number(id), Number(userId)))) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
