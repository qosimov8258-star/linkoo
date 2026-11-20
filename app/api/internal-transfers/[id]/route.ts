import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { toTransferInput, transferBodySchema, transferResponse } from "@/lib/internal-transfers-api"
import { deleteTransfer, getTransfer, SHIPMENT_READ_ONLY, updateTransfer } from "@/lib/internal-transfers-repo"
import { withProductFacts } from "@/lib/internal-transfers-series"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const transfer = await getTransfer(parseIdSegment((await params).id) ?? 0)
  if (!transfer) return NextResponse.json({ error: "Передача не найдена" }, { status: 404 })
  // Each line with its product's expiry flag and box (the card's Серия column and Группа line).
  return NextResponse.json(await withProductFacts(transfer))
}

/** Edit ("Изменить"), any status as in Linko: isConfirmed toggles 'ожидает' / 'потвержден'; a transfer in transit or
 * accepted keeps its status and its changed goods are checked as movements (updateTransfer). */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id) ?? 0
  const parsed = await parseJsonBody(request, transferBodySchema)
  if (parsed.error) return parsed.error

  const input = toTransferInput({ ...parsed.data, autoAccept: false })
  return transferResponse(await updateTransfer(id, input, auth.user.displayName))
}

/** Hard delete of a transfer without stock effect; 'в пути' / 'принят' must be cancelled back first. A production
 * «Отгрузка» is never deleted: 409 with the same text as an edit of it. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const result = await deleteTransfer(parseIdSegment((await params).id) ?? 0)
  if (result === "not_found") return NextResponse.json({ error: "Передача не найдена" }, { status: 404 })
  if (result === "shipment") return NextResponse.json({ error: SHIPMENT_READ_ONLY }, { status: 409 })
  if (result === "locked") return NextResponse.json({ error: "Удаление невозможно из-за связи с другими данными" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
