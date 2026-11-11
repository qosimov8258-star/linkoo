import { NextRequest, NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { listIncomingLogs } from "@/lib/supplier-incomings-repo"
import { incomingNotFound } from "@/lib/supplier-incomings-api"
import { parseRouteId } from "@/lib/supplier-refs"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  const id = parseRouteId((await params).id)
  const logs = id ? await listIncomingLogs(id) : null
  return logs ? NextResponse.json(logs) : incomingNotFound()
}
