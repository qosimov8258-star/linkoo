import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createClientPayment, listClientPayments } from "@/lib/client-payments-repo"

const clientPaymentSchema = z.object({
  clientId: z.coerce.number().finite(),
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
  return NextResponse.json((await listClientPayments(clientId)))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientPaymentSchema)
  if (parsed.error) return parsed.error

  const payment = await createClientPayment({
    clientId: parsed.data.clientId,
    clientName: parsed.data.clientName ?? "",
    amount: parsed.data.amount,
    comment: parsed.data.comment ?? "",
    paymentDate: parsed.data.paymentDate || new Date().toISOString().slice(0, 10),
  })
  return NextResponse.json(payment, { status: 201 })
}
