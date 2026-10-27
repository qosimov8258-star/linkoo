import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createRivalProduct, listRivalProducts } from "@/lib/rival-products-repo"

const schema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  competitor: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listRivalProducts())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await createRivalProduct({ name: parsed.data.name, competitor: parsed.data.competitor ?? "" })
  return NextResponse.json(item, { status: 201 })
}
