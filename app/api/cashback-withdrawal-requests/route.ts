import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createCashbackWithdrawalRequest, listCashbackWithdrawalRequests } from "@/lib/cashback-withdrawal-requests-repo"

const cashbackWithdrawalRequestSchema = z.object({
  client: z.string().trim().min(1),
  amount: z.coerce.number().finite(),
  currency: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listCashbackWithdrawalRequests()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, cashbackWithdrawalRequestSchema)
  if (parsed.error) return parsed.error

  const created = await createCashbackWithdrawalRequest({
    client: parsed.data.client,
    amount: parsed.data.amount,
    currency: parsed.data.currency || "SUM",
  })
  return NextResponse.json(created, { status: 201 })
}
