import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { parseTransferListQuery, toTransferInput, transferBodySchema, transferResponse } from "@/lib/internal-transfers-api"
import { listAllTransfers, listTransfers } from "@/lib/internal-transfers-list"
import { createTransfer } from "@/lib/internal-transfers-repo"

/** List. With page / pageSize: `{count, page, pageSize, results}` (filters, see
 * parseTransferListQuery); without them: the legacy array of every transfer. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const query = parseTransferListQuery(request.url)
  return NextResponse.json(query ? await listTransfers(query) : await listAllTransfers())
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, transferBodySchema)
  if (parsed.error) return parsed.error

  return transferResponse(await createTransfer(toTransferInput(parsed.data), auth.user.displayName), true)
}
