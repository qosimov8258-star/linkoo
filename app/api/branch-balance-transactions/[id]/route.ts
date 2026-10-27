import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { routeId } from "@/lib/finance/api"
import { requireRole } from "@/lib/rbac"
import { deleteBranchBalanceTransaction, getBranchBalanceTransaction } from "@/lib/branch-balance-repo"
import { notSignedInResponse } from "@/lib/validation"

// One manual branch ledger row. The demo page has no edit/delete UI for
// branch transactions; DELETE exists for managers to undo a wrong entry.
type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const id = routeId((await params).id)
  const transaction = id ? await getBranchBalanceTransaction(id) : null
  if (!transaction) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(transaction)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = routeId((await params).id)
  const ok = id !== null && (await deleteBranchBalanceTransaction(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
