import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createOrderTimeRestriction, listOrderTimeRestrictions } from "@/lib/order-time-restrictions-repo"

const orderTimeRestrictionSchema = z.object({
  name: z.string().trim().min(1),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  fullDay: z.boolean().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listOrderTimeRestrictions()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, orderTimeRestrictionSchema)
  if (parsed.error) return parsed.error

  const item = (await createOrderTimeRestriction({
    name: parsed.data.name,
    from: parsed.data.from || "00:00",
    to: parsed.data.to || "23:59",
    fullDay: parsed.data.fullDay ?? false,
  }))
  return NextResponse.json(item, { status: 201 })
}
