import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { createSupplierReturn, listSupplierReturns, parseSupplierReturnInput, supplierReturnSchema } from "@/lib/supplier-returns-repo"
import { parseProcurementBody, procurementWrite } from "@/lib/supplier-refs"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listSupplierReturns()))
}

/** 400 with field errors for bad lines (qty ≤ 0, price < 0, unknown product) and unknown
 * supplier / warehouse / branch / organization / currency / date. */
export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseProcurementBody(request, supplierReturnSchema)
  if (parsed.error) return parsed.error

  return procurementWrite(async () => NextResponse.json(await createSupplierReturn(parseSupplierReturnInput(parsed.data), auth.user.displayName), { status: 201 }))
}
