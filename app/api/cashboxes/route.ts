import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createCashbox, listCashboxes } from "@/lib/cashboxes-repo"

const cashboxSchema = z.object({
  name: z.string().trim().min(1),
  currency: z.string().trim().min(1),
  cashier: z.string().trim().min(1),
  branch: z.string().trim().optional(),
  paymentType: z.string().trim().min(1),
  vansell: z.boolean().optional(),
  orderNumber: z.coerce.number().finite(),
})

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const search = request.nextUrl.searchParams.get("q") ?? undefined
  return NextResponse.json((await listCashboxes(search)))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, cashboxSchema)
  if (parsed.error) return parsed.error

  const cashbox = await createCashbox({
    name: parsed.data.name,
    currency: parsed.data.currency,
    cashier: parsed.data.cashier,
    branch: parsed.data.branch ?? "",
    paymentType: parsed.data.paymentType,
    vansell: parsed.data.vansell ?? false,
    orderNumber: parsed.data.orderNumber,
  })
  return NextResponse.json(cashbox, { status: 201 })
}
