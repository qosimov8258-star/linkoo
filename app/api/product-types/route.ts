import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createProductType, listProductTypes } from "@/lib/product-types-repo"

const productTypeSchema = z.object({
  name: z.string().trim().min(1),
  organization: z.string().trim().min(1),
  parentId: z.number().finite().nullable().optional(),
  showInBot: z.boolean().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listProductTypes()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, productTypeSchema)
  if (parsed.error) return parsed.error

  const type = (await createProductType({
    name: parsed.data.name,
    organization: parsed.data.organization,
    parentId: parsed.data.parentId ?? null,
    showInBot: parsed.data.showInBot ?? false,
  }))
  return NextResponse.json(type, { status: 201 })
}
