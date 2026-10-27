import { NextResponse } from "next/server"

import { routeId } from "@/lib/finance/api"
import { requireRole } from "@/lib/rbac"
import { deleteClientCorrection, FinanceInputError } from "@/lib/finance-store-reconciliation-writes"

// DELETE /api/store-reconciliation/corrections/[id] — undo of a manual client
// correction ("Списать" / "Добавить" Прочие приходы, "Установить долг с Excel"
// lines): soft delete, the client ledger stops counting it. A "Добавить" /
// Оплата row is a customer payment and is deleted from "Оплаты от клиентов".
type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = routeId((await params).id)
  if (!id) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  try {
    return NextResponse.json(await deleteClientCorrection(id, auth.user.displayName || auth.user.username))
  } catch (error) {
    if (error instanceof FinanceInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
