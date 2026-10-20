import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"
import { cashErrorResponse } from "@/lib/cash/api"
import { isDbId } from "@/lib/cash/common"
import { cashManagementEntrySchema, createCashManagementEntry, listCashManagementEntries } from "@/lib/cash-management-entries-repo"

// Legacy cash entries API (old flat shape). Reads list live entries; writes are
// thin wrappers over the cash core (lib/cash-management-entries-repo.ts) — the
// cash page itself uses /api/cash/operations.
// GET  /api/cash-management-entries?cashboxId → CashManagementEntry[] (not deleted)
// POST /api/cash-management-entries { cashboxId, category | categoryId, amount ±, … } → 201 { key, source, id, docNo, entry }
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const cashboxIdParam = request.nextUrl.searchParams.get("cashboxId")
  const cashboxId = cashboxIdParam ? (parseIdSegment(cashboxIdParam.trim()) ?? 0) : undefined
  if (cashboxIdParam && !isDbId(cashboxId)) return NextResponse.json([])
  return NextResponse.json(await listCashManagementEntries(cashboxId))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, cashManagementEntrySchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createCashManagementEntry(parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
