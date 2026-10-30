import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { deleteTelegramUser } from "@/lib/telegram-users-repo"

// DELETE /api/telegram-users/[id] — removes a bot user (the red minus on the list row). A change of the clients
// section: manager role and, for a user with an access right, clients.manage (lib/capabilities-catalog.ts).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const { id } = await params
  // A telegram id: a positive integer that fits BIGINT (18 digits at most).
  if (!/^[1-9]\d{0,17}$/.test(id)) return NextResponse.json({ error: "Неверный идентификатор" }, { status: 400 })
  if (!(await deleteTelegramUser(id))) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
