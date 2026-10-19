import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createWriteOff, listWriteOffs, parseWriteOffInput } from "@/lib/write-offs-repo"

const writeOffSchema = z.object({
  warehouse: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  comment: z.string().optional(),
  items: z.array(z.record(z.string(), z.unknown())).min(1),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listWriteOffs()))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, writeOffSchema)
  if (parsed.error) return parsed.error

  const input = parseWriteOffInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Склад, причина и товары обязательны" }, { status: 400 })

  return NextResponse.json((await createWriteOff(input)), { status: 201 })
}
