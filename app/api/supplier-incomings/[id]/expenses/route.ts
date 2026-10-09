import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { addIncomingExpense, listIncomingExpenses } from "@/lib/supplier-incomings-repo"
import { incomingChangeResponse } from "@/lib/supplier-incomings-api"

const expenseSchema = z.object({
  date: z.string().trim().min(1),
  description: z.string().trim().min(1),
  amount: z.coerce.number().finite().positive(),
  currency: z.string().trim().default("SUM"),
  paymentType: z.string().trim().default(""),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listIncomingExpenses(Number((await params).id)))
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, expenseSchema)
  if (parsed.error) return parsed.error
  const result = await addIncomingExpense(Number((await params).id), parsed.data, auth.user.displayName)
  return incomingChangeResponse(result, "Нельзя добавить расход к отмененной поставке")
}
