import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listSubscriptions } from "@/lib/subscriptions-repo"

const id = (value: string | null) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const result = await listSubscriptions({
    tab: params.get("tab") === "without" ? "without" : "with",
    search: (params.get("search") ?? "").trim(),
    ordering: params.get("ordering") ?? "subscription_end_date",
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: Math.min(2000, Math.max(1, Number(params.get("pageSize")) || 25)),
    filters: {
      license: (params.get("license") ?? "").trim(),
      accessRightId: id(params.get("accessRight")),
      branchId: id(params.get("branch")),
      zoneId: id(params.get("zone")),
      priceListId: id(params.get("priceList")),
      jobId: id(params.get("job")),
      organizationId: id(params.get("organization")),
      ending: params.get("ending") === "1",
    },
  })
  return NextResponse.json(result)
}
