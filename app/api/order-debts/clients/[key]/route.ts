import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getClientDebtDetail } from "@/lib/finance-order-debts"
import { DEBT_BUCKETS, type DebtBucket } from "@/lib/finance-order-debts-types"

// GET /api/order-debts/clients/[key]?debtType&page&pageSize → OrderDebtClientDetail (client drill-down).
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const key = decodeURIComponent((await params).key)
  const search = new URL(request.url).searchParams
  const debtType = search.get("debtType") ?? ""
  if (debtType && !(DEBT_BUCKETS as readonly string[]).includes(debtType)) {
    return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: { fieldErrors: { debtType: ["first | second | third | fourth"] } } }, { status: 400 })
  }
  const page = Number(search.get("page") ?? 1)
  const pageSize = Number(search.get("pageSize") ?? 25)
  const detail = await getClientDebtDetail(key, {
    debtType: debtType as DebtBucket | "",
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? Math.max(0, pageSize) : 25,
  })
  if (!detail) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json(detail)
}
