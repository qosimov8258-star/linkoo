import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteDelivererCorrection, getDelivererCorrection } from "@/lib/finance-deliverer-debts"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseIdSegment } from "@/lib/validation"

// One "Корректировка" of a deliverer: GET / DELETE (the statement marks these
// rows editable, source "deliverer_manual", sourceId = id).

function parseId(value: string): number | null {
  return parseIdSegment(value)
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseId((await params).id)
  const correction = id ? await getDelivererCorrection(id) : null
  if (!correction) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(correction)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseId((await params).id)
  if (!id || !(await deleteDelivererCorrection(id))) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
