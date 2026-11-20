import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listTransferSeries } from "@/lib/internal-transfers-series"
import { notSignedInResponse } from "@/lib/validation"

/** GET ?product=<id>&search=&pageSize=50 — the Серия picker of the transfer form (Linko's stock/series_balance/):
 * {count, results: [{id, productId, number, expirationDate, displayName}]}, the latest expiry first. */
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  const product = params.get("product") ?? ""
  if (!/^\d{1,10}$/.test(product)) return NextResponse.json({ error: "Неверный идентификатор", field: "product" }, { status: 400 })
  const size = Number(params.get("pageSize") ?? 50)
  return NextResponse.json(await listTransferSeries(Number(product), (params.get("search") ?? "").slice(0, 100), Number.isFinite(size) ? size : 50))
}
