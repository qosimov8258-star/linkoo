import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, convertSchema, parseConvertQuery } from "@/lib/cash/api"
import { convertCurrency } from "@/lib/cash/cashboxes"

// GET  /api/cash/convert?from&to&amount&fromRate&toRate&cashboxId → ConvertResult
// POST /api/cash/convert  { from, to, amount?, fromRate?, toRate?, cashboxId? } → ConvertResult
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseConvertQuery(request.url)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await convertCurrency(parsed.data))
  } catch (error) {
    return cashErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = await parseJsonBody(request, convertSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await convertCurrency(parsed.data))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
