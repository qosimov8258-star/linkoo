import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getOrderFormOptions } from "@/lib/order-create-options"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/orders/form-options → {agents, deliverers, priceLists, defaults: {agent, priceList, warehouse}}:
// the «Добавление заказа» lists and defaults of the signed-in user (Linko's crud/for_select lists and
// the authConfirm user, price lists and warehouses), see lib/order-create-options.ts.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getOrderFormOptions(user))
}
