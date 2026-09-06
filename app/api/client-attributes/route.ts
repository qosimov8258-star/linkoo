import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createClientAttribute, listClientAttributes } from "@/lib/client-attributes-repo"

const clientAttributeSchema = z.object({
  name: z.string().trim().min(1),
  fieldType: z.enum(["Выбор вариантов", "Текстовое поле", "Цифровое поле"]).optional(),
  required: z.boolean().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listClientAttributes()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientAttributeSchema)
  if (parsed.error) return parsed.error

  const attribute = await createClientAttribute({
    name: parsed.data.name,
    fieldType: parsed.data.fieldType ?? "Выбор вариантов",
    required: parsed.data.required ?? false,
  })
  return NextResponse.json(attribute, { status: 201 })
}
