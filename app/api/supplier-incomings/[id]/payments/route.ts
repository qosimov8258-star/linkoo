import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listIncomingPayments } from "@/lib/supplier-incomings-repo"
import { parseRouteId } from "@/lib/supplier-refs"
import { notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/supplier-incomings/[id]/payments → SupplyPaymentsResult ("Список оплат по поставке №N":
// live verified supplier payments linked to the supply; "На поставку" in the supply currency).
export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const id = parseRouteId((await params).id)
  const result = id ? await listIncomingPayments(id) : null
  if (!result) return NextResponse.json({ error: "Поставка не найдена" }, { status: 404 })
  return NextResponse.json(result)
}
