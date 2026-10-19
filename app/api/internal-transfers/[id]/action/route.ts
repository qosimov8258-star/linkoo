import { NextRequest } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { transferActionSchema, transferResponse } from "@/lib/internal-transfers-api"
import { transferAction } from "@/lib/internal-transfers-repo"
import type { TransferAction } from "@/lib/internal-transfers-types"

type RouteParams = { params: Promise<{ id: string }> }

/** Status change: { action: approve | give | cancel_given | accept | cancel_accepted | cancel, comment?, date? }.
 * 200 → the updated transfer; 409 { error } when the transition is not allowed or the goods are missing. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id) || 0
  const parsed = await parseJsonBody(request, transferActionSchema)
  if (parsed.error) return parsed.error

  const { action, comment, date } = parsed.data
  return transferResponse(await transferAction(id, action as TransferAction, { comment, date }, auth.user.displayName))
}
