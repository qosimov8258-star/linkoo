import { NextRequest, NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { deleteWriteOff } from "@/lib/write-offs-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteWriteOff(id))
  if (!ok) return NextResponse.json({ error: "Списание не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
