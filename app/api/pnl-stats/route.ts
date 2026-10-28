import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getPnlOptions, getPnlStats } from "@/lib/pnl-stats-repo"

const list = (params: URLSearchParams, key: string) => (params.get(key) ?? "").split("|").filter(Boolean)
const isoDate = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const params = request.nextUrl.searchParams
  if (params.get("options")) return NextResponse.json(await getPnlOptions())

  const period = (prefix: string) => ({ begin: params.get(`${prefix}_begin`) ?? "", end: params.get(`${prefix}_end`) ?? "" })
  const first = period("first")
  const second = period("second")
  if (![first.begin, first.end, second.begin, second.end].every((value) => isoDate.test(value))) {
    return NextResponse.json({ error: "Требуются first_begin, first_end, second_begin и second_end" }, { status: 400 })
  }

  return NextResponse.json(
    await getPnlStats(first, second, {
      branches: list(params, "branches"),
      zones: list(params, "zones"),
      agents: list(params, "agents"),
      productTypes: list(params, "productTypes"),
      products: list(params, "products"),
    }),
  )
}
