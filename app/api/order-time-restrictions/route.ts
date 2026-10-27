import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { getServerT } from "@/lib/i18n/server"
import { listOrderTimeRestrictions } from "@/lib/order-time-restrictions-repo"
import { ORDER_TIME_PAGE_SIZES, type OrderTimeRestrictionPage } from "@/lib/order-time-restrictions-rules"
import { nameKey } from "@/lib/platform-refs"
import { INVALID_DATA_MESSAGE, invalidFieldResponse, notSignedInResponse } from "@/lib/validation"

// GET /api/order-time-restrictions?search=&page=1&pageSize=25 → {count, page, pageSize, results}
// The two system restrictions (Создания заказа, Редактировать заказ). `search` matches the
// name in the UI language (and the Russian name), case-insensitively. There is no POST and no
// DELETE: the rows are fixed; PUT /api/order-time-restrictions/[id] sets a row's window.

const MAX_SEARCH = 200

export const GET = withDbErrors(async (request: NextRequest) => {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const params = request.nextUrl.searchParams
  const pageText = params.get("page")
  const page = pageText === null || pageText === "" ? 1 : /^\d{1,7}$/.test(pageText) ? Number(pageText) : 0
  if (page < 1) return invalidFieldResponse("page", "page", INVALID_DATA_MESSAGE)
  const sizeText = params.get("pageSize") ?? params.get("page_size")
  const pageSize = sizeText === null || sizeText === "" ? 25 : Number(sizeText)
  if (!(ORDER_TIME_PAGE_SIZES as readonly number[]).includes(pageSize) || (sizeText !== null && sizeText !== "" && !/^\d+$/.test(sizeText))) {
    return invalidFieldResponse("pageSize", "pageSize", INVALID_DATA_MESSAGE)
  }
  const search = nameKey((params.get("search") ?? "").slice(0, MAX_SEARCH))

  const rows = await listOrderTimeRestrictions()
  const t = await getServerT()
  const matched = search ? rows.filter((row) => nameKey(t(row.name)).includes(search) || nameKey(row.name).includes(search)) : rows
  const body: OrderTimeRestrictionPage = {
    count: matched.length,
    page,
    pageSize,
    results: matched.slice((page - 1) * pageSize, page * pageSize),
  }
  return NextResponse.json(body)
})
