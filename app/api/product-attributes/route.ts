import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createProductAttribute, listProductAttributes } from "@/lib/product-attributes-repo"

const schema = z.object({
  name: z.string().trim().min(1),
  fieldType: z.enum(["Выбор вариантов", "Текстовое поле", "Цифровое поле"]).optional(),
  allTypes: z.boolean().optional(),
  types: z.array(z.string()).optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listProductAttributes())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await createProductAttribute({
    name: parsed.data.name,
    fieldType: parsed.data.fieldType ?? "Выбор вариантов",
    allTypes: parsed.data.allTypes ?? true,
    types: parsed.data.types ?? [],
  })
  return NextResponse.json(item, { status: 201 })
}
