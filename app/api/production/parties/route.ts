import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, isDateParam, notFound, parseBody, positiveIntParam, requireViewer, schemas } from "@/lib/production-api"
import { createParty, listParties } from "@/lib/production-batches-repo"

export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const status = params.get("status")
  const date = (name: string) => {
    const value = params.get(name)
    return isDateParam(value) ? value : undefined
  }
  const instant = (name: string) => {
    const value = params.get(name)
    return value && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) ? value : undefined
  }
  return NextResponse.json(
    await listParties({
      status: status === "pending" || status === "finished" || status === "cancelled" ? status : undefined,
      search: params.get("search") ?? undefined,
      stageId: positiveIntParam(params.get("stageId")),
      madeKey: params.get("madeKey") ?? undefined,
      rawKey: params.get("rawKey") ?? undefined,
      dateFrom: date("dateFrom"),
      dateTo: date("dateTo"),
      finishedFrom: instant("finishedFrom"),
      finishedTo: instant("finishedTo"),
    }),
  )
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, schemas.party)
  if (parsed.error) return parsed.error
  return guarded(async () => {
    const party = await createParty(parsed.data, auth.user.displayName)
    return party === "stage_not_found" ? notFound("Этап не найден") : NextResponse.json(party, { status: 201 })
  })
}
