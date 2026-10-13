import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { supplierIncomingSchema } from "@/lib/supplier-incomings-api"
import { InvoiceLinkError } from "@/lib/invoice-incomings-link"
import { createIncoming, listIncomings, parseIncomingInput } from "@/lib/supplier-incomings-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listIncomings())
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, supplierIncomingSchema)
  if (parsed.error) return parsed.error

  const input = parseIncomingInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Поставщик, склад и товары обязательны" }, { status: 400 })

  try {
    return NextResponse.json(await createIncoming(input, auth.user.displayName), { status: 201 })
  } catch (error) {
    if (error instanceof InvoiceLinkError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
