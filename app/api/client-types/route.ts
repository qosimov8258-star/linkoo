import { NextResponse } from "next/server"
import { z } from "zod"

import { nameField, parseBody, textField } from "@/lib/auth-request"
import { ClientTypeError, createClientType, listClientTypes } from "@/lib/client-types-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"

const clientTypeSchema = z.object({
  name: nameField("Укажите название типа клиента", 200),
  supplier: textField(200).optional(),
  parentId: z.number().int().nullable().optional(),
  innRequired: z.boolean().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listClientTypes())
}

// POST /api/client-types {name, supplier?} — 409 for a name that already exists (case-insensitive).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, clientTypeSchema)
  if (parsed.error) return parsed.error

  try {
    const clientType = await createClientType({
      name: parsed.data.name,
      supplier: parsed.data.supplier || "Не указано",
      parentId: parsed.data.parentId ?? null,
      innRequired: parsed.data.innRequired ?? false,
    })
    return NextResponse.json(clientType, { status: 201 })
  } catch (error) {
    if (error instanceof ClientTypeError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
