import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createCapability, listCapabilities } from "@/lib/capabilities-repo"

const capabilityNameSchema = z.object({
  name: z.string().trim().min(1),
})

export async function GET() {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  return NextResponse.json((await listCapabilities()))
}

export async function POST(request: Request) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, capabilityNameSchema)
  if (parsed.error) return parsed.error

  const capability = (await createCapability(parsed.data.name))
  if (!capability) return NextResponse.json({ error: "Такая возможность уже существует" }, { status: 409 })
  return NextResponse.json(capability, { status: 201 })
}
