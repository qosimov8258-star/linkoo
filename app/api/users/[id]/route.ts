import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { deleteUser } from "@/lib/users-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  if (id === auth.user.id) return NextResponse.json({ error: "O'zingizni o'chira olmaysiz" }, { status: 400 })

  const ok = await deleteUser(id)
  if (!ok) return NextResponse.json({ error: "Foydalanuvchi topilmadi" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
