import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, verifySchema } from "@/lib/cash/api"
import { verifyCashOperation } from "@/lib/cash/write"

// POST /api/cash/operations/[key]/verify  { verifyDate?: "YYYY-MM-DD" | null } → CashWriteResult.
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, verifySchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await verifyCashOperation((await params).key, parsed.data.verifyDate, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
