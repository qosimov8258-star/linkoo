import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { createSupplierCategory, listSupplierCategories, parseSupplierCategoryInput } from "@/lib/supplier-categories-repo"
import { parseProcurementBody, procurementWrite } from "@/lib/supplier-refs"

const supplierCategorySchema = z.object({
  name: z.string({ error: "Наименование обязательно" }).trim().min(1, "Наименование обязательно").max(255, "Не более 255 символов"),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listSupplierCategories()))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseProcurementBody(request, supplierCategorySchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierCategoryInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  return procurementWrite(async () => NextResponse.json(await createSupplierCategory(input), { status: 201 }))
}
