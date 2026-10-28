import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteTelegramUser } from "@/lib/telegram-users-repo"

// DELETE /api/telegram-users/[id] — removes a bot user (the red minus on the list row).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Неверный идентификатор" }, { status: 400 })
  if (!(await deleteTelegramUser(id))) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
