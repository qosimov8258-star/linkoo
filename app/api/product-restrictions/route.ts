import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { applyProductRestriction, listProductRestrictions } from "@/lib/product-restrictions-repo"

const applyRestrictionSchema = z.object({
  scope: z.enum(["products", "types"]),
  employee: z.string().trim().min(1).max(255, "Не более 255 символов"),
  mode: z.enum(["add", "remove", "replace"]),
  items: z.array(z.string()).optional(),
})

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const scope = searchParams.get("scope") === "types" ? "types" : "products"
  return NextResponse.json((await listProductRestrictions(scope)))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, applyRestrictionSchema)
  if (parsed.error) return parsed.error

  const list = (await applyProductRestriction({
    scope: parsed.data.scope,
    employee: parsed.data.employee,
    mode: parsed.data.mode,
    items: parsed.data.items ?? [],
  }))
  return NextResponse.json(list, { status: 201 })
}
