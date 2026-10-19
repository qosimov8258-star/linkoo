import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { deleteWriteOff, getWriteOff } from "@/lib/write-offs-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const writeOff = await getWriteOff(Number((await params).id) || 0)
  if (!writeOff) return NextResponse.json({ error: "Списание не найдено" }, { status: 404 })
  return NextResponse.json(writeOff)
}

/** Hard delete of a pending / cancelled write-off; a finished one must be cancelled first. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const result = await deleteWriteOff(Number((await params).id) || 0)
  if (result === "not_found") return NextResponse.json({ error: "Списание не найдено" }, { status: 404 })
  if (result === "locked") return NextResponse.json({ error: "Удаление невозможно из-за связи с другими данными" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
