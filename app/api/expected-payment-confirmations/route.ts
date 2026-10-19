import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createExpectedPaymentConfirmation, listExpectedPaymentConfirmations } from "@/lib/expected-payment-confirmations-repo"

const expectedPaymentConfirmationSchema = z.object({
  orderId: z.coerce.number().finite(),
  amount: z.coerce.number().finite(),
  client: z.string().trim().optional(),
  currency: z.string().trim().optional(),
  date: z.string().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listExpectedPaymentConfirmations()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, expectedPaymentConfirmationSchema)
  if (parsed.error) return parsed.error

  const created = (await createExpectedPaymentConfirmation({
    orderId: parsed.data.orderId,
    amount: parsed.data.amount,
    client: parsed.data.client ?? "",
    currency: parsed.data.currency || "SUM",
    date: parsed.data.date || new Date().toISOString(),
  }))
  return NextResponse.json(created, { status: 201 })
}
