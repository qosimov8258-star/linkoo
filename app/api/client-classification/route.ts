import { NextRequest, NextResponse } from "next/server"

import { getClassification, getClassificationOptions, type ClassificationParams } from "@/lib/client-classification-repo"
import { getCurrentUser } from "@/lib/current-user"

const list = (params: URLSearchParams, key: string) => (params.get(key) ?? "").split("|").filter(Boolean)
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const params = request.nextUrl.searchParams
  if (params.get("options")) return NextResponse.json(await getClassificationOptions())

  const dates = ["first", "second", "third"].map((name) => ({ from: params.get(`${name}_begin_date`) ?? "", to: params.get(`${name}_end_date`) ?? "" }))
  if (dates.some((period) => !DATE.test(period.from) || !DATE.test(period.to))) {
    return NextResponse.json({ error: "Требуются first/second/third_begin_date и _end_date" }, { status: 400 })
  }
  const classes = list(params, "classes")
    .map((item) => {
      const cut = item.lastIndexOf(":")
      return { name: item.slice(0, cut), amount: Number(item.slice(cut + 1)) }
    })
    .filter((item) => item.name && item.amount > 0)

  const closed = params.get("closed_status")
  const dateType = params.get("date_type")
  const query: ClassificationParams = {
    closed: closed === "closed" || closed === "all" ? closed : "not_closed",
    statuses: (params.get("order_status") ?? "2-3").split("-").map(Number).filter((id) => Number.isInteger(id)),
    dateType: dateType === "created_date" || dateType === "accepted_time" ? dateType : "date_delivery",
    periods: dates as ClassificationParams["periods"],
    classes,
    zones: list(params, "zones"),
    brands: list(params, "brands"),
    productTypes: list(params, "productTypes"),
    agents: list(params, "agents"),
    branches: list(params, "branches"),
    marketTypes: list(params, "marketTypes"),
  }
  return NextResponse.json(await getClassification(query))
}
