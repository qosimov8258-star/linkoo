import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { correctionSchema, createClientCorrection, FinanceInputError } from "@/lib/finance-store-reconciliation-writes"

// POST /api/store-reconciliation/corrections — "Списать" (kind expense) /
// "Добавить" (kind income = Прочие приходы, kind payment = Оплата (Кассир не
// принял)) of one client (demo sales/client_transaction type 9 / 1).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, correctionSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createClientCorrection(parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    if (error instanceof FinanceInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
