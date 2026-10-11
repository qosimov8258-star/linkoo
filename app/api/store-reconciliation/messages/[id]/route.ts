import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { messageStatusSchema, updateReconciliationStatus } from "@/lib/finance-store-reconciliation-writes"

type RouteParams = { params: Promise<{ id: string }> }

// PUT /api/store-reconciliation/messages/[id] {status, variant?} — status of a
// reconciliation request (pending | confirmed | rejected | not_send) of a shop
// (variant client, default) or an account, for a future Telegram bot integration.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })

  const parsed = await parseJsonBody(request, messageStatusSchema)
  if (parsed.error) return parsed.error

  const message = await updateReconciliationStatus(id, parsed.data.status, parsed.data.variant)
  if (!message) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(message)
}
