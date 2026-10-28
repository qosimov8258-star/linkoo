import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteUserNotification, markUserNotificationViewed } from "@/lib/user-notifications-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  if (!(await markUserNotificationViewed(Number((await params).id)))) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  if (!(await deleteUserNotification(Number((await params).id)))) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
