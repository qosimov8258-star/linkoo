import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getSalesOptions, getSalesStats } from "@/lib/sales-stats-repo"

const list = (params: URLSearchParams, key: string) => (params.get(key) ?? "").split("|").filter(Boolean)

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const params = request.nextUrl.searchParams
  if (params.get("options")) return NextResponse.json(await getSalesOptions())

  const begin = params.get("begin")
  const end = params.get("end")
  if (!begin || !end) return NextResponse.json({ error: "Требуются begin и end" }, { status: 400 })

  return NextResponse.json(
    await getSalesStats(begin, end, {
      zones: list(params, "zones"),
      marketTypes: list(params, "marketTypes"),
      productTypes: list(params, "productTypes"),
      agents: list(params, "agents"),
      brands: list(params, "brands"),
    }),
  )
}
