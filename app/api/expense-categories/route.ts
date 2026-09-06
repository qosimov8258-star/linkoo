import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createExpenseCategory, listExpenseCategories } from "@/lib/expense-categories-repo"

const expenseCategorySchema = z.object({
  name: z.string().trim().min(1),
  parameter: z.string().trim().optional(),
  parentId: z.number().finite().nullable().optional(),
  direct: z.boolean().optional(),
  excludeFromPnl: z.boolean().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listExpenseCategories()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, expenseCategorySchema)
  if (parsed.error) return parsed.error

  const category = (await createExpenseCategory({
    name: parsed.data.name,
    parameter: parsed.data.parameter ?? "",
    parentId: parsed.data.parentId ?? null,
    direct: parsed.data.direct ?? false,
    excludeFromPnl: parsed.data.excludeFromPnl ?? false,
  }))
  return NextResponse.json(category, { status: 201 })
}
