import { NextRequest, NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { requireRole } from "@/lib/rbac"
import { addIncomingEventLog, listIncomingLogs } from "@/lib/supplier-incomings-repo"
import { incomingChangeResponse, incomingEventLogSchema, incomingNotFound } from "@/lib/supplier-incomings-api"
import { parseProcurementBody, parseRouteId, procurementWrite } from "@/lib/supplier-refs"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  const id = parseRouteId((await params).id)
  const logs = id ? await listIncomingLogs(id) : null
  return logs ? NextResponse.json(logs) : incomingNotFound()
}

/** «Добавить лог»: «Вышел с завода» / «Прибыл в таможню» with the event day and a comment (not for an inventory surplus). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return incomingNotFound()
  const parsed = await parseProcurementBody(request, incomingEventLogSchema)
  if (parsed.error) return parsed.error

  const body = { action: parsed.data.action, date: parsed.data.date ?? "", comment: parsed.data.comment ?? "" }
  return procurementWrite(async () => incomingChangeResponse(await addIncomingEventLog(id, body, auth.user.displayName), "Для инвентаризации логи не добавляются"))
}
