import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createAccessRight, listAccessRights } from "@/lib/access-rights-repo"

const accessRightSchema = z.object({
  name: z.string().trim().min(1),
  capabilityIds: z.array(z.number()).optional(),
})

export async function GET() {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  return NextResponse.json((await listAccessRights()))
}

export async function POST(request: Request) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, accessRightSchema)
  if (parsed.error) return parsed.error

  const accessRight = await createAccessRight({ name: parsed.data.name, capabilityIds: parsed.data.capabilityIds ?? [] })
  return NextResponse.json(accessRight, { status: 201 })
}
