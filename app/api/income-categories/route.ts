import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createIncomeCategory, listIncomeCategories } from "@/lib/income-categories-repo"

const incomeCategorySchema = z.object({
  name: z.string().trim().min(1),
  parameter: z.string().trim().optional(),
  otherIncome: z.boolean().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listIncomeCategories()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, incomeCategorySchema)
  if (parsed.error) return parsed.error

  const category = (await createIncomeCategory({
    name: parsed.data.name,
    parameter: parsed.data.parameter ?? "",
    otherIncome: parsed.data.otherIncome ?? false,
  }))
  return NextResponse.json(category, { status: 201 })
}
