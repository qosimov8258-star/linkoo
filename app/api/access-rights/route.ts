import { NextResponse } from "next/server"

import { AccessRightError, createAccessRight, listAccessRights } from "@/lib/access-rights-repo"
import { accessRightSchema, accessRightErrorResponse } from "@/app/api/access-rights/schema"
import { parseBody } from "@/lib/auth-request"
import { requireRole } from "@/lib/rbac"

export async function GET() {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  return NextResponse.json(await listAccessRights())
}

// POST /api/access-rights {name, capabilityIds?} — 409 for a name that exists
// (case-insensitively), 400 for capability ids that do not exist.
export async function POST(request: Request) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, accessRightSchema)
  if (parsed.error) return parsed.error

  try {
    const accessRight = await createAccessRight({ name: parsed.data.name, capabilityIds: parsed.data.capabilityIds ?? [] })
    return NextResponse.json(accessRight, { status: 201 })
  } catch (error) {
    if (error instanceof AccessRightError) return accessRightErrorResponse(error)
    throw error
  }
}
