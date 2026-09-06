import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createEmployeeBalanceTransaction, listEmployeeBalanceTransactions } from "@/lib/employee-balance-repo"

const employeeBalanceTransactionSchema = z.object({
  employeeId: z.coerce.number().positive(),
  kind: z.enum(["add", "expense"]),
  currency: z.enum(["sum", "usd", "eur"]),
  amount: z.coerce.number().positive(),
  date: z.string().trim().optional(),
  comment: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listEmployeeBalanceTransactions()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, employeeBalanceTransactionSchema)
  if (parsed.error) return parsed.error

  const transaction = (await createEmployeeBalanceTransaction({
    employeeId: parsed.data.employeeId,
    kind: parsed.data.kind,
    currency: parsed.data.currency,
    amount: parsed.data.amount,
    date: parsed.data.date || new Date().toISOString().slice(0, 10),
    comment: parsed.data.comment ?? "",
  }))
  return NextResponse.json(transaction, { status: 201 })
}
