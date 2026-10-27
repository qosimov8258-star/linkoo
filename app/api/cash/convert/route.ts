import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, convertSchema, parseConvertQuery } from "@/lib/cash/api"
import { convertCurrency } from "@/lib/cash/cashboxes"

// GET  /api/cash/convert?from&to&amount&fromRate&toRate&cashboxId → ConvertResult
// POST /api/cash/convert  { from, to, amount?, fromRate?, toRate?, cashboxId? } → ConvertResult
export async function GET(request: Request) {
  const auth = await requireRole("viewer")
  if ("error" in auth) return auth.error
  const parsed = parseConvertQuery(request.url)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await convertCurrency(parsed.data))
  } catch (error) {
    return cashErrorResponse(error)
  }
}

export async function POST(request: Request) {
  // A read-only calculation, but under /api/cash: the route checks cash.manage itself
  // (the edge no longer checks access-right permissions).
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, convertSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await convertCurrency(parsed.data))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
