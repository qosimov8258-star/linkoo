import { NextResponse } from "next/server"
import { z } from "zod"

import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseIdSegment } from "@/lib/validation"
import { cashErrorResponse } from "@/lib/cash/api"
import { createClientPayment, listClientPayments } from "@/lib/client-payments-repo"
import { dbId, strictNum } from "@/lib/strict-number"

// GET  /api/client-payments?clientId → ClientPayment[] (live customer_payments of the client + legacy client_payments rows).
// POST /api/client-payments { clientId, amount, currency?, comment?, paymentDate? } → 201 ClientPayment ("Добавить оплату"
//      of the client card): a not accepted customer payment without a cashbox (accept it on "Оплаты от клиентов").
const clientPaymentSchema = z.object({
  clientId: dbId("Клиент не найден"),
  clientName: z.string().trim().max(300).optional(),
  amount: strictNum(
    z
      .number({ error: "Укажите сумму" })
      .finite({ error: "Укажите сумму" })
      .positive({ error: "Укажите сумму" })
      .max(1e13, { error: "Слишком большая сумма" }),
    "Укажите сумму",
  ),
  currency: z.string().trim().max(10).optional(),
  comment: z.string().trim().max(2000).optional(),
  paymentDate: z.string().trim().max(40).optional(),
})

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const clientIdParam = new URL(request.url).searchParams.get("clientId")
  if (clientIdParam === null || clientIdParam.trim() === "") return NextResponse.json(await listClientPayments(undefined))
  // A client id that is not a positive int4 matches no client (never a 500).
  const clientId = parseIdSegment(clientIdParam.trim())
  return NextResponse.json(clientId ? await listClientPayments(clientId) : [])
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, clientPaymentSchema)
  if (parsed.error) return parsed.error

  try {
    const payment = await createClientPayment(
      {
        clientId: parsed.data.clientId,
        clientName: parsed.data.clientName ?? "",
        amount: parsed.data.amount,
        currency: parsed.data.currency || undefined,
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
