import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listSubscriptions } from "@/lib/subscriptions-repo"
import { notSignedInResponse, parseIdSegment } from "@/lib/validation"

// Подписки: the employees with / without a license subscription (the license packages, purchases,
// attach / detach / extend live under /api/subscriptions/*). Filter ids are positive int4 ids
// ("1e3", "-1", "1.5" or values beyond int4 are no filter); page / page size are whole numbers.

/** A whole number in min..max, else the fallback. */
function wholeNumber(value: string | null, fallback: number, min: number, max: number): number {
  if (!value || !/^\d{1,9}$/.test(value)) return fallback
  return Math.min(max, Math.max(min, Number(value)))
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  const id = (name: string) => parseIdSegment(params.get(name))
  const result = await listSubscriptions({
    tab: params.get("tab") === "without" ? "without" : "with",
    search: (params.get("search") ?? "").trim().slice(0, 200),
    ordering: params.get("ordering") ?? "subscription_end_date",
    page: wholeNumber(params.get("page"), 1, 1, 1_000_000),
    pageSize: wholeNumber(params.get("pageSize"), 25, 1, 2000),
    filters: {
      license: (params.get("license") ?? "").trim().slice(0, 100),
      accessRightId: id("accessRight"),
      branchId: id("branch"),
      zoneId: id("zone"),
      priceListId: id("priceList"),
      jobId: id("job"),
      organizationId: id("organization"),
      ending: params.get("ending") === "1",
    },
  })
  return NextResponse.json(result)
}
