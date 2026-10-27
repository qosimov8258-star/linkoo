import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { cashErrorResponse } from "@/lib/cash/api"
import { isDbId } from "@/lib/cash/common"
import { deleteAccountBulkPayment } from "@/lib/account-bulk-payments-repo"
import { parseIdSegment } from "@/lib/validation"

// DELETE /api/account-bulk-payments/[id] → { id, deleted } — cancels a stored legacy
// group payment (soft delete; the client ledger stops counting it).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = (parseIdSegment((await params).id) ?? 0)
  if (!isDbId(id)) return NextResponse.json({ error: "Оплата не найдена", field: null }, { status: 404 })
  try {
    return NextResponse.json(await deleteAccountBulkPayment(id, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
