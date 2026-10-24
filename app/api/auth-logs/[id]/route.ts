import { NextResponse } from "next/server"
import { z } from "zod"

import { setAuthLogActive } from "@/lib/auth-logs-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const bodySchema = z.object({ active: z.boolean() })

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, bodySchema)
  if (parsed.error) return parsed.error
  const log = await setAuthLogActive(id, parsed.data.active)
  if (!log) return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 })
  return NextResponse.json(log)
}
