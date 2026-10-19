import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createClientBulkPayment, listClientBulkPayments } from "@/lib/client-bulk-payments-repo"

const clientBulkPaymentSchema = z.object({
  clientIds: z.array(z.number()).optional(),
  currency: z.string().trim().optional(),
  amount: z.coerce.number().finite().positive(),
  paymentDate: z.string().trim().optional(),
  comment: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listClientBulkPayments()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientBulkPaymentSchema)
  if (parsed.error) return parsed.error

  const payment = await createClientBulkPayment({
    clientIds: parsed.data.clientIds ?? [],
    currency: parsed.data.currency || "sum",
    amount: parsed.data.amount,
    paymentDate: parsed.data.paymentDate || new Date().toISOString().slice(0, 10),
    comment: parsed.data.comment ?? "",
  })
  return NextResponse.json(payment, { status: 201 })
}
