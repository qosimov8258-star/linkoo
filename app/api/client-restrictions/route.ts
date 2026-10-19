import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createClientRestriction, listClientRestrictions } from "@/lib/client-restrictions-repo"

const clientRestrictionSchema = z.object({
  name: z.string().trim().min(1),
  config: z
    .object({
      type: z.string().optional(),
      by: z.string().optional(),
      minQty: z.boolean().optional(),
      clients: z.array(z.string()).optional(),
      items: z.array(z.object({ name: z.string(), qty: z.number() })).optional(),
    })
    .optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listClientRestrictions()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientRestrictionSchema)
  if (parsed.error) return parsed.error

  const restriction = (await createClientRestriction(parsed.data))
  return NextResponse.json(restriction, { status: 201 })
}
