import { NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { invoiceErrorResponse, parseIdParam } from "@/lib/invoice-incomings-api"
import { getSupplyDraft } from "@/lib/invoice-incomings-repo"

type RouteParams = { params: Promise<{ id: string }> }

/** Prefill of "Приход от поставщика" created from an accepted invoice. */
export async function GET(_request: Request, { params }: RouteParams) {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  const id = parseIdParam((await params).id)
  if (!id) return NextResponse.json({ error: "Счет-фактура не найдена" }, { status: 404 })
  try {
    return NextResponse.json(await getSupplyDraft(id))
  } catch (error) {
    return invoiceErrorResponse(error)
  }
}
