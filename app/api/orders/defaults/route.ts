import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { getOrderDefaults } from "@/lib/orders-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/orders/defaults[?clientId=N][&agent=…][&warehouse=…] → {agent, priceList, warehouse, organization}:
// the defaults of the "Добавление заказа" dialog. Without a client: no agent and no
// warehouse; the price list marked "default for orders"; the only organization.
// With a client: its agent, the default price list (else its branch's), its branch's
// single sales warehouse and the organization of its contracts / agent / warehouse
// (agent / warehouse = the dialog's current choices when given).
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const params = request.nextUrl.searchParams
  const rawClient = params.get("clientId")?.trim() ?? ""
  const clientId = rawClient ? routeId(rawClient) : undefined
  if (clientId === null) return NextResponse.json({ error: "Неверный идентификатор", field: "clientId" }, { status: 400 })
  const text = (name: string): string | undefined | null => {
    if (!params.has(name)) return undefined
    const value = (params.get(name) ?? "").trim()
    return value.length > 200 ? null : value
  }
  const agent = text("agent")
  const warehouse = text("warehouse")
  if (agent === null) return NextResponse.json({ error: "Слишком длинное значение", field: "agent" }, { status: 400 })
  if (warehouse === null) return NextResponse.json({ error: "Слишком длинное значение", field: "warehouse" }, { status: 400 })

  try {
    return NextResponse.json(await getOrderDefaults({ clientId, agent, warehouse }))
  } catch (error) {
    return orderErrorResponse(error)
  }
}
