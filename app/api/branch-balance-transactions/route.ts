import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createBranchBalanceTransaction, listBranchBalanceTransactions } from "@/lib/branch-balance-repo"

const branchBalanceTransactionSchema = z.object({
  branchId: z.coerce.number().finite().positive(),
  branchName: z.string().trim().optional(),
  kind: z.enum(["add", "expense"]).optional(),
  currency: z.enum(["sum", "usd"]).optional(),
  amount: z.coerce.number().finite().positive(),
  date: z.string().trim().optional(),
  comment: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listBranchBalanceTransactions()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, branchBalanceTransactionSchema)
  if (parsed.error) return parsed.error

  const transaction = await createBranchBalanceTransaction({
    branchId: parsed.data.branchId,
    branchName: parsed.data.branchName ?? "",
    kind: parsed.data.kind ?? "add",
    currency: parsed.data.currency ?? "sum",
    amount: parsed.data.amount,
    date: parsed.data.date || new Date().toISOString().slice(0, 10),
    comment: parsed.data.comment ?? "",
  })
  return NextResponse.json(transaction, { status: 201 })
}
