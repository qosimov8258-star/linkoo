import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { toTransferInput, transferBodySchema, transferResponse } from "@/lib/internal-transfers-api"
import { deleteTransfer, getTransfer, updateTransfer } from "@/lib/internal-transfers-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const transfer = await getTransfer(Number((await params).id) || 0)
  if (!transfer) return NextResponse.json({ error: "Передача не найдена" }, { status: 404 })
  return NextResponse.json(transfer)
}

/** Edit ("Изменить"): only while 'ожидает' / 'потвержден'; isConfirmed toggles between them. */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id) || 0
  const parsed = await parseJsonBody(request, transferBodySchema)
  if (parsed.error) return parsed.error

  const input = toTransferInput({ ...parsed.data, autoAccept: false })
  return transferResponse(await updateTransfer(id, input, auth.user.displayName))
}

/** Hard delete of a transfer without stock effect; 'в пути' / 'принят' must be cancelled back first. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const result = await deleteTransfer(Number((await params).id) || 0)
  if (result === "not_found") return NextResponse.json({ error: "Передача не найдена" }, { status: 404 })
  if (result === "locked") return NextResponse.json({ error: "Удаление невозможно из-за связи с другими данными" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
