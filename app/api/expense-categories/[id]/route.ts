import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteExpenseCategory, updateExpenseCategory } from "@/lib/expense-categories-repo"

const expenseCategorySchema = z.object({
  name: z.string().trim().min(1),
  parameter: z.string().trim().optional(),
  parentId: z.number().finite().nullable().optional(),
  direct: z.boolean().optional(),
  excludeFromPnl: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, expenseCategorySchema)
  if (parsed.error) return parsed.error

  const category = (await updateExpenseCategory(id, {
    name: parsed.data.name,
    parameter: parsed.data.parameter ?? "",
    parentId: parsed.data.parentId ?? null,
    direct: parsed.data.direct ?? false,
    excludeFromPnl: parsed.data.excludeFromPnl ?? false,
  }))
  if (!category) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })
  return NextResponse.json(category)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteExpenseCategory(id))
  if (!ok) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
