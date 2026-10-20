import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { supplierIncomingSchema } from "@/lib/supplier-incomings-api"
import { InvoiceLinkError } from "@/lib/invoice-incomings-link"
import { createIncoming, listIncomings, parseIncomingInput } from "@/lib/supplier-incomings-repo"
import { parseProcurementBody, procurementWrite } from "@/lib/supplier-refs"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listIncomings())
}

/** 400 with field errors for bad lines (qty ≤ 0, cost < 0, …) and unknown supplier /
 * warehouse / branch / organization / currency / product / date. */
export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseProcurementBody(request, supplierIncomingSchema)
  if (parsed.error) return parsed.error

  return procurementWrite(async () => {
    try {
      return NextResponse.json(await createIncoming(parseIncomingInput(parsed.data), auth.user.displayName), { status: 201 })
    } catch (error) {
      if (error instanceof InvoiceLinkError) return NextResponse.json({ error: error.message }, { status: error.status })
      throw error
    }
  })
}
