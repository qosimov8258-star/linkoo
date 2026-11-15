import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { getKpiPerformance } from "@/lib/kpi-performance-repo"

function clampMonth(value: string | null) {
  const month = Number(value)
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1
}

function clampYear(value: string | null) {
  const year = Number(value)
  return Number.isInteger(year) && year >= 1970 && year <= 2200 ? year : new Date().getFullYear()
}

/** GET /api/kpi-performance?month=&year=[&kpi=<id>]: «Выполнения KPI» — the KPI cards and the stored rows of the month
 * (of one KPI when `kpi` is given), and the moment of the last «Перерасчет» (POST /api/salary-records/recalculate). */
export async function GET(request: Request) {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error
  const url = new URL(request.url)
  const kpi = Number(url.searchParams.get("kpi"))
  return NextResponse.json(
    await getKpiPerformance(clampMonth(url.searchParams.get("month")), clampYear(url.searchParams.get("year")), Number.isInteger(kpi) && kpi > 0 ? kpi : null),
  )
}
