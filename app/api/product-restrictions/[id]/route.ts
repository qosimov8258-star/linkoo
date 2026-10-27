import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { EMPLOYEE_NOT_FOUND, getRestrictionDetail, productRestrictionErrorResponse } from "@/lib/product-restrictions-repo"
import { invalidIdResponse, notSignedInResponse, parseIdSegment } from "@/lib/validation"

// GET /api/product-restrictions/:employeeId → {id, name, active, products: [{id, name, deleted?}],
// productTypes: [{id, name}]} (empty lists = "Не установлено"). 404 for an unknown employee.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  try {
    const detail = await getRestrictionDetail(id)
    if (!detail) return NextResponse.json({ error: EMPLOYEE_NOT_FOUND }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    const response = productRestrictionErrorResponse(error)
    if (response) return response
    throw error
  }
}
