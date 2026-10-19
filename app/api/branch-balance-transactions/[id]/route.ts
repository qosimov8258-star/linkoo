import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { deleteBranchBalanceTransaction, getBranchBalanceTransaction } from "@/lib/branch-balance-repo"

// One manual branch ledger row. The demo page has no edit/delete UI for
// branch transactions; DELETE exists for managers to undo a wrong entry.
type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const transaction = Number.isInteger(id) && id > 0 ? await getBranchBalanceTransaction(id) : null
  if (!transaction) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(transaction)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = Number.isInteger(id) && id > 0 && (await deleteBranchBalanceTransaction(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
