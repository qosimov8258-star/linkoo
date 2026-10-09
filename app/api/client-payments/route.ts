import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse } from "@/lib/cash/api"
import { createClientPayment, listClientPayments } from "@/lib/client-payments-repo"

// GET  /api/client-payments?clientId → ClientPayment[] (live customer_payments of the client + legacy client_payments rows).
// POST /api/client-payments { clientId, amount, comment?, paymentDate? } → 201 ClientPayment ("Добавить оплату" of the
//      client card): a not accepted customer payment without a cashbox (accept it on "Оплаты от клиентов").
const clientPaymentSchema = z.object({
  clientId: z.coerce.number().int().positive(),
  clientName: z.string().trim().optional(),
  amount: z.coerce.number().finite().positive(),
  comment: z.string().trim().optional(),
  paymentDate: z.string().trim().optional(),
})

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const clientIdParam = new URL(request.url).searchParams.get("clientId")
  const clientId = clientIdParam ? Number(clientIdParam) : undefined
  return NextResponse.json(await listClientPayments(Number.isInteger(clientId) ? clientId : undefined))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientPaymentSchema)
  if (parsed.error) return parsed.error

  try {
    const payment = await createClientPayment(
      {
        clientId: parsed.data.clientId,
        clientName: parsed.data.clientName ?? "",
        amount: parsed.data.amount,
        comment: parsed.data.comment ?? "",
        paymentDate: parsed.data.paymentDate ?? "",
      },
      auth.user.displayName,
    )
    return NextResponse.json(payment, { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
