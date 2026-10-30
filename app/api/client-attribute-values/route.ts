import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import {
  ClientAttributeValueError,
  clientAttributeValueInput,
  clientAttributeValueSchema,
  createClientAttributeValue,
  listClientAttributeValues,
} from "@/lib/client-attribute-values-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listClientAttributeValues())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientAttributeValueSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createClientAttributeValue(clientAttributeValueInput(parsed.data)), { status: 201 })
  } catch (error) {
    if (error instanceof ClientAttributeValueError) {
      return NextResponse.json({ error: error.message, ...(error.field ? { fields: { [error.field]: error.message } } : {}) }, { status: error.status })
    }
    throw error
  }
}
