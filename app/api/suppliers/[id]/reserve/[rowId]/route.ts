import { NextRequest, NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { removeSupplierReserve } from "@/lib/suppliers-repo"
import { parseRouteId } from "@/lib/supplier-refs"

type RouteParams = { params: Promise<{ id: string; rowId: string }> }

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const { id, rowId } = await params
  const supplierId = parseRouteId(id)
  const lineId = parseRouteId(rowId)
  const supplier = supplierId && lineId ? await removeSupplierReserve(supplierId, lineId) : null
  if (!supplier) return NextResponse.json({ error: "Поставщик не найден" }, { status: 404 })
  return NextResponse.json(supplier)
}
