import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { invoiceErrorResponse, parseIdParam } from "@/lib/invoice-incomings-api"
import { getSupplyDraft } from "@/lib/invoice-incomings-repo"
import { notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

/** Prefill of "Приход от поставщика" created from an accepted invoice. */
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseIdParam((await params).id)
  if (!id) return NextResponse.json({ error: "Счет-фактура не найдена" }, { status: 404 })
  try {
    return NextResponse.json(await getSupplyDraft(id))
  } catch (error) {
    return invoiceErrorResponse(error)
  }
}
