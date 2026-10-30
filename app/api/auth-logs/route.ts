import { NextResponse } from "next/server"

import { listAuthLogs } from "@/lib/auth-logs-repo"
import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { isIsoDay } from "@/lib/finance/dates"
import { parseIdSegment, notSignedInResponse } from "@/lib/validation"

const date = (value: string | null) => (value && isIsoDay(value) ? value : "")
/** A positive page / page size of the query, else the default. */
const positive = (value: string | null, fallback: number) => {
  const number = parseIdSegment(value)
  return number ?? fallback
}

// "Сессия" journal (Settings → Персонал). An administrator or a manager with settings.manage sees every account's
// sign-ins; everyone else only the sign-ins of their own account (lib/auth-logs-repo.ts canManageAuthLogs) — never
// another user's address or browser.
export const GET = withDbErrors(async (request: Request) => {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  const result = await listAuthLogs(
    {
      tab: params.get("tab") === "not_active" ? "not_active" : "active",
      search: (params.get("search") ?? "").trim().slice(0, 200),
      userId: parseIdSegment(params.get("user")),
      createdFrom: date(params.get("createdFrom")),
      createdTo: date(params.get("createdTo")),
      lastFrom: date(params.get("lastFrom")),
      lastTo: date(params.get("lastTo")),
      page: Math.min(1_000_000, positive(params.get("page"), 1)),
      pageSize: Math.min(2000, positive(params.get("pageSize"), 25)),
    },
    user,
  )
  return NextResponse.json(result)
})
