import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createVansellTransaction, listVansels, parseVansellTransactionInput } from "@/lib/vansell-transactions-repo"

const vansellTransactionSchema = z.object({
  vanselId: z.coerce.number().finite().positive(),
  amount: z.coerce.number().finite().positive(),
  currency: z.enum(["sum", "usd", "eur"]).optional(),
  kind: z.enum(["add", "expense"]).optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listVansels()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, vansellTransactionSchema)
  if (parsed.error) return parsed.error

  const input = parseVansellTransactionInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Обязательные поля не заполнены" }, { status: 400 })

  const vansel = (await createVansellTransaction(input))
  if (!vansel) return NextResponse.json({ error: "Вансел не найден" }, { status: 404 })
  return NextResponse.json(vansel, { status: 201 })
}
