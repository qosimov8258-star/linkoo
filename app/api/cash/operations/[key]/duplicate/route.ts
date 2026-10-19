import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, duplicateSchema } from "@/lib/cash/api"
import { duplicateCashOperation } from "@/lib/cash/write"

// POST /api/cash/operations/[key]/duplicate  { date? } → 201 CashWriteResult ("Дублировать").
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, duplicateSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await duplicateCashOperation((await params).key, auth.user.displayName, parsed.data.date), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
