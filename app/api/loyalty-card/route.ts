import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createLoyaltyCardTransaction, listLoyaltyCardClients } from "@/lib/loyalty-card-repo"

const loyaltyTransactionSchema = z.object({
  clientId: z.coerce.number().refine((value) => Number.isFinite(value) && value !== 0),
  amount: z.coerce.number().positive(),
  currency: z.string().optional(),
  kind: z.string().optional(),
  comment: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listLoyaltyCardClients()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, loyaltyTransactionSchema)
  if (parsed.error) return parsed.error

  const client = (await createLoyaltyCardTransaction({
    clientId: parsed.data.clientId,
    currency: parsed.data.currency === "euro" || parsed.data.currency === "usd" ? parsed.data.currency : "sum",
    amount: parsed.data.amount,
    kind: parsed.data.kind === "expense" ? "expense" : "add",
    comment: parsed.data.comment ?? "",
  }))
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json(client, { status: 201 })
}
