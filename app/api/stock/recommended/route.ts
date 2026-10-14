import { NextResponse } from "next/server"

import { parseRecommendedPaging, recommendedList, recommendedRequest } from "@/lib/stock-recommended"

// GET /api/stock/recommended?from&to&warehouse*&organization*&type*&subcategory*&brand*&search
//   &unit=measurement|weight|capacity|box&ordering=[-]sold|salePart|available|byDay|remainDays|week|month|weight|name
//   &page&pageSize (0 = all) → RecommendedListResult ("Рекомендованный запас").
// Default period: the 1st of the month two months back … the end of this month; default ordering -sold.
export async function GET(request: Request) {
  const parsed = await recommendedRequest(request.url)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await recommendedList(parsed.filters, parseRecommendedPaging(parsed.params)))
  } catch (error) {
    console.error("recommended stock:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
