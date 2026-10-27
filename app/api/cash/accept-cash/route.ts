import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"
import { acceptCash, listAcceptGroups } from "@/lib/cash/accept"
import { acceptCashSchema, cashErrorResponse, parseAcceptGroupsQuery } from "@/lib/cash/api"

// GET  /api/cash/accept-cash?from&to&branch*&cashbox* → { groups: AcceptGroup[] } (agent collections waiting).
// POST /api/cash/accept-cash  { cashboxId, date?, comment?, ids | group } → 201 AcceptCashResult.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseAcceptGroupsQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json({ groups: await listAcceptGroups(parsed.data) })
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, acceptCashSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await acceptCash(parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
