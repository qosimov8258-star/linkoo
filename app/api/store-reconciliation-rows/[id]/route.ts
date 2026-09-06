import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteStoreReconciliationRow, updateStoreReconciliationRow } from "@/lib/store-reconciliation-repo"

const storeReconciliationRowPatchSchema = z.object({
  client: z.string().trim().optional(),
  connected: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, storeReconciliationRowPatchSchema)
  if (parsed.error) return parsed.error

  const patch: Record<string, unknown> = {}
  if (parsed.data.client !== undefined) patch.client = parsed.data.client
  if (parsed.data.connected !== undefined) patch.connected = parsed.data.connected

  const row = (await updateStoreReconciliationRow(id, patch as never))
  if (!row) return NextResponse.json({ error: "Строка не найдена" }, { status: 404 })
  return NextResponse.json(row)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteStoreReconciliationRow(id))
  if (!ok) return NextResponse.json({ error: "Строка не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
