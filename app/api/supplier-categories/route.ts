import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createSupplierCategory, listSupplierCategories, parseSupplierCategoryInput } from "@/lib/supplier-categories-repo"

const supplierCategorySchema = z.object({
  name: z.string().trim().min(1),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listSupplierCategories()))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, supplierCategorySchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierCategoryInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  return NextResponse.json((await createSupplierCategory(input)), { status: 201 })
}
