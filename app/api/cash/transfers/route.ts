import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, transferSchema } from "@/lib/cash/api"
import { createTransfer } from "@/lib/cash/transfers"

// POST /api/cash/transfers  CashTransferInput → 201 CashTransferResult ("Перевод").
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, transferSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createTransfer(parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
