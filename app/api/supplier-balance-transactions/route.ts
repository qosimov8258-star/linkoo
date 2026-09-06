import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import {
  createSupplierBalanceTransaction,
  listSupplierBalanceTransactions,
  parseSupplierBalanceTransactionInput,
} from "@/lib/supplier-balance-repo"

const supplierBalanceTransactionSchema = z.object({
  supplierId: z.coerce.number().finite().positive(),
  kind: z.enum(["add", "expense", "fund_request"]),
  currency: z.enum(["sum", "usd", "eur"]),
  amount: z.coerce.number().finite().positive(),
  date: z.string().trim().optional(),
  comment: z.string().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listSupplierBalanceTransactions()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, supplierBalanceTransactionSchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierBalanceTransactionInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Некорректные данные транзакции" }, { status: 400 })

  const transaction = (await createSupplierBalanceTransaction(input))
  return NextResponse.json(transaction, { status: 201 })
}
