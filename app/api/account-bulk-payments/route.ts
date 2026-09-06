import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createAccountBulkPayment, listAccountBulkPayments } from "@/lib/account-bulk-payments-repo"

const accountBulkPaymentSchema = z.object({
  clientIds: z.array(z.number()).optional(),
  currency: z.string().trim().optional(),
  amount: z.coerce.number().positive(),
  paymentDate: z.string().trim().optional(),
  comment: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listAccountBulkPayments()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, accountBulkPaymentSchema)
  if (parsed.error) return parsed.error

  const payment = await createAccountBulkPayment({
    clientIds: parsed.data.clientIds ?? [],
    currency: parsed.data.currency || "sum",
    amount: parsed.data.amount,
    paymentDate: parsed.data.paymentDate || new Date().toISOString().slice(0, 10),
    comment: parsed.data.comment ?? "",
  })
  return NextResponse.json(payment, { status: 201 })
}
