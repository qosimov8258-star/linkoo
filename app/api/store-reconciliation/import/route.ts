import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { debtImportSchema, FinanceInputError, importDebts } from "@/lib/finance-store-reconciliation-writes"

// POST /api/store-reconciliation/import — "Установить долг с Excel" (demo
// sales/market_balance/import_balance_excel). Body: debtDate, currency,
// organizations, byPaymentType, mode, fileName, rows (template lines as text),
// commit. commit = false → preview; true → corrections are written so each
// client's balance on the debt day becomes the uploaded amount.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, debtImportSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await importDebts(parsed.data, auth.user.displayName), { status: parsed.data.commit ? 201 : 200 })
  } catch (error) {
    if (error instanceof FinanceInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
