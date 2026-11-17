import { NextRequest, NextResponse } from "next/server"

import { getClassification, getClassificationMarkets, getClassificationOptions, getClassificationProducts, type ClassificationParams } from "@/lib/client-classification-repo"
import { getCurrentUser } from "@/lib/current-user"
import { strictNumber } from "@/lib/strict-number"

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
      // Strict: "0x10" / "1e999" / "12abc" are no class limit.
      return { name: item.slice(0, cut), amount: strictNumber(item.slice(cut + 1)) }
    })
    .filter((item) => item.name && Number.isFinite(item.amount) && item.amount > 0 && item.amount <= 1e13)

  const closed = params.get("closed_status")
  const dateType = params.get("date_type")
  const query: ClassificationParams = {
    closed: closed === "closed" || closed === "all" ? closed : "not_closed",
    // Status ids (0 = «В процессе»), digits only. Without a choice Linko counts every status (a cancelled order never
    // counts: lib/client-classification-repo.ts has no id for it).
    statuses: (params.get("order_status") || "0-1-2-3-5").split("-").filter((id) => /^\d{1,2}$/.test(id)).map(Number),
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
  // The list under the table: ?markets=1&period=first|second|third&bucket=<row index, 0 = «Нет заказа»>.
  if (params.get("markets")) {
    const period = ["first", "second", "third"].indexOf(params.get("period") ?? "")
    const bucket = Number(params.get("bucket"))
    if (period < 0 || !Number.isInteger(bucket) || bucket < 0 || bucket > 1000) return NextResponse.json({ error: "Неверный период или класс" }, { status: 400 })
    return NextResponse.json(await getClassificationMarkets(query, period as 0 | 1 | 2, bucket))
  }
  // «Ассортимент» of one store: ?products=1&market=<id>&group_by=product|product_type|brand&count_type=amount|sum.
  if (params.get("products")) {
    const market = Number(params.get("market"))
    const groupBy = params.get("group_by")
    const countType = params.get("count_type")
    if (!Number.isInteger(market) || market <= 0) return NextResponse.json({ error: "Неверный клиент" }, { status: 400 })
    return NextResponse.json(
      await getClassificationProducts(
        query,
        market,
        groupBy === "product_type" || groupBy === "brand" ? groupBy : "product",
        countType === "sum" ? "sum" : "amount",
      ),
    )
  }
  return NextResponse.json(await getClassification(query))
}
