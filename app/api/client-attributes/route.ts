import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { ClientAttributeError, clientAttributeInput, clientAttributeSchema, createClientAttribute, listClientAttributes } from "@/lib/client-attributes-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listClientAttributes())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientAttributeSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createClientAttribute(clientAttributeInput(parsed.data)), { status: 201 })
  } catch (error) {
    if (error instanceof ClientAttributeError) return NextResponse.json({ error: error.message, fields: { name: error.message } }, { status: error.status })
    throw error
  }
}
