import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createCashManagementEntry, listCashManagementEntries } from "@/lib/cash-management-entries-repo"

const cashManagementEntrySchema = z.object({
  cashboxId: z.coerce.number().finite(),
  description: z.string().optional(),
  category: z.string().optional(),
  clientName: z.string().optional(),
  branch: z.string().optional(),
  organization: z.string().optional(),
  comment: z.string().optional(),
  date: z.string().optional(),
  amount: z.coerce.number().finite(),
})

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const cashboxIdParam = request.nextUrl.searchParams.get("cashboxId")
  const cashboxId = cashboxIdParam ? Number(cashboxIdParam) : undefined
  return NextResponse.json((await listCashManagementEntries(cashboxId)))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, cashManagementEntrySchema)
  if (parsed.error) return parsed.error

  const created = await createCashManagementEntry({
    cashboxId: parsed.data.cashboxId,
    description: parsed.data.description ?? "",
    category: parsed.data.category ?? "",
    clientName: parsed.data.clientName ?? "",
    branch: parsed.data.branch ?? "",
    organization: parsed.data.organization ?? "",
    comment: parsed.data.comment ?? "",
    date: parsed.data.date || new Date().toISOString(),
    amount: parsed.data.amount,
  })
  return NextResponse.json(created, { status: 201 })
}
