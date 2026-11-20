import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { docYearOk } from "@/lib/document-dates"
import { errorResponse, guarded, isDateParam, notFound, parseBody, positiveIntParam, requireViewer, schemas } from "@/lib/production-api"
import { createParty, listParties, listPartiesPage, PARTY_ORDERING_KEYS, PARTY_PAGE_SIZE_MAX, parsePartyItemKeys } from "@/lib/production-batches-repo"

/**
 * The Партии list. With `page` / `pageSize` it answers one page ({count, page, pageSize, results}) sorted by
 * `ordering` (id, -id, status, -status), as the reference pages on the server; `focus=<id>` answers the page holding
 * that batch. Without them: every matching batch, newest first. Filters: status, search (the № or the stage name),
 * stageId, madeKey / rawKey (item keys, comma separated: any of them), the batch date dateFrom / dateTo, and the
 * creation / finish ranges createdFrom / createdTo / finishedFrom / finishedTo as business days (YYYY-MM-DD) or
 * ISO instants.
 */
export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const status = params.get("status")
  const date = (name: string) => {
    const value = params.get(name)
    return isDateParam(value) ? value : undefined
  }
  const day = (name: string) => {
    const value = params.get(name)
    if (isDateParam(value)) return docYearOk(value) ? value : undefined
    return value && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) ? value : undefined
  }
  // A malformed item key (an id beyond int4, "product:1.5") is refused here instead of reaching Postgres.
  const madeKeys = parsePartyItemKeys(params.get("madeKey"))
  const rawKeys = parsePartyItemKeys(params.get("rawKey"))
  if (!madeKeys || !rawKeys) return errorResponse("Неверный товар", 400, { field: madeKeys ? "rawKey" : "madeKey" })
  const filters = {
    status: status === "pending" || status === "finished" || status === "cancelled" ? status : undefined,
    search: params.get("search") ?? undefined,
    stageId: positiveIntParam(params.get("stageId")),
    madeKey: madeKeys.map((key) => `${key.kind}:${key.id}`),
    rawKey: rawKeys.map((key) => `${key.kind}:${key.id}`),
    dateFrom: date("dateFrom"),
    dateTo: date("dateTo"),
    createdFrom: day("createdFrom"),
    createdTo: day("createdTo"),
    finishedFrom: day("finishedFrom"),
    finishedTo: day("finishedTo"),
  }
  const paged = params.has("page") || params.has("pageSize")
  const ordering = params.get("ordering") ?? ""
  return guarded(async () => {
    if (!paged) return NextResponse.json(await listParties(filters))
    return NextResponse.json(
      await listPartiesPage(filters, {
        ordering: PARTY_ORDERING_KEYS.includes(ordering) ? ordering : undefined,
        page: positiveIntParam(params.get("page")) ?? 1,
        pageSize: Math.min(positiveIntParam(params.get("pageSize")) ?? 25, PARTY_PAGE_SIZE_MAX),
        focus: positiveIntParam(params.get("focus")),
      }),
    )
  })
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
