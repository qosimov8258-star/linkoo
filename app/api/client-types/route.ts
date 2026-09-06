import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createClientType, listClientTypes } from "@/lib/client-types-repo"

const clientTypeSchema = z.object({
  name: z.string().trim().min(1),
  supplier: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listClientTypes()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientTypeSchema)
  if (parsed.error) return parsed.error

  const clientType = await createClientType({
    name: parsed.data.name,
    supplier: parsed.data.supplier || "Не указано",
  })
  return NextResponse.json(clientType, { status: 201 })
}
