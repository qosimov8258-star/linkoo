import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listIncomingLogs } from "@/lib/supplier-incomings-repo"
import { incomingNotFound } from "@/lib/supplier-incomings-api"
import { parseRouteId } from "@/lib/supplier-refs"
import { notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const id = parseRouteId((await params).id)
  const logs = id ? await listIncomingLogs(id) : null
  return logs ? NextResponse.json(logs) : incomingNotFound()
}
