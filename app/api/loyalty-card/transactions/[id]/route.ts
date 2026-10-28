import { NextResponse } from "next/server"

import { deleteLoyaltyCardTransaction, LoyaltyInputError } from "@/lib/loyalty-card-repo"
import { requireRole } from "@/lib/rbac"

// DELETE /api/loyalty-card/transactions/[id] — soft delete of a manual "Добавить" / "Списать" movement of the cashback card.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  try {
    return NextResponse.json(await deleteLoyaltyCardTransaction(id))
  } catch (error) {
    if (error instanceof LoyaltyInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
