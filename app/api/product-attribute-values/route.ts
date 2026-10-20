import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createProductAttributeValue, listProductAttributeValues } from "@/lib/product-attribute-values-repo"

const clientAttributeValueSchema = z.object({
  attribute: z.string().trim().min(1).max(255, "Не более 255 символов"),
  values: z.array(z.string().trim()).optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listProductAttributeValues()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientAttributeValueSchema)
  if (parsed.error) return parsed.error

  const item = await createProductAttributeValue({
    attribute: parsed.data.attribute,
    values: (parsed.data.values ?? []).filter((v) => v.length > 0),
  })
  return NextResponse.json(item, { status: 201 })
}
