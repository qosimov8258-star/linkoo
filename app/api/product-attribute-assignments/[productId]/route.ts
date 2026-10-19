import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { getProductAttributeAssignments, setProductAttributeAssignments } from "@/lib/product-attribute-assignments-repo"

const schema = z.object({ values: z.record(z.string(), z.string()) })

type RouteParams = { params: Promise<{ productId: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await getProductAttributeAssignments(Number((await params).productId)))
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return NextResponse.json(await setProductAttributeAssignments(Number((await params).productId), parsed.data.values))
}
