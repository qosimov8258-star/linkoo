import { NextResponse } from "next/server"

import { getBonusClient, listClientBonusEntries } from "@/lib/client-bonuses-repo"
import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { NOT_FOUND_MESSAGE, invalidIdResponse, notSignedInResponse, parseIdSegment } from "@/lib/validation"

type Params = { params: Promise<{ id: string }> }

// GET /api/client-bonuses/<client id>/entries[?promotion=<id>] → {client: {id, name}, entries: [...]}: the history of a
// client's points, newest first (Linko's sales/client_promotion/<id>/detail/, its «Акция» filter = promotion).
export const GET = withDbErrors(async (request: Request, { params }: Params) => {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const rawPromotion = new URL(request.url).searchParams.get("promotion")
  const promotion = rawPromotion ? parseIdSegment(rawPromotion) : null
  if (rawPromotion && promotion === null) return invalidIdResponse()
  const client = await getBonusClient(id)
  if (!client) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })
  return NextResponse.json({ client, entries: await listClientBonusEntries(id, { promotion }) })
})
