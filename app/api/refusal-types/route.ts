import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createRefusalType, listRefusalTypes, parseRefusalTypeInput, RefusalTypeError } from "@/lib/refusal-types-repo"

const refusalTypeSchema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  resolution: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listRefusalTypes()))
}

// POST /api/refusal-types {name, resolution?} — 409 for a name that exists (case- and space-insensitive).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, refusalTypeSchema)
  if (parsed.error) return parsed.error

  const input = parseRefusalTypeInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  try {
    return NextResponse.json(await createRefusalType(input), { status: 201 })
  } catch (error) {
    if (error instanceof RefusalTypeError) return NextResponse.json({ error: error.message, field: "name" }, { status: error.status })
    throw error
  }
}
