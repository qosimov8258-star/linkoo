import { NextResponse } from "next/server"
import { z } from "zod"

import { nameField, parseBody } from "@/lib/auth-request"
import { CapabilityError, createCapability, listCapabilities } from "@/lib/capabilities-repo"
import { requireRole } from "@/lib/rbac"

const capabilitySchema = z.object({
  name: nameField("Укажите наименование", 120),
  permissionIds: z
    .array(z.number({ error: "Неизвестное разрешение" }).int({ error: "Неизвестное разрешение" }).positive({ error: "Неизвестное разрешение" }).max(2_147_483_647, { error: "Неизвестное разрешение" }))
    .max(500)
    .optional(),
})

export async function GET() {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  return NextResponse.json(await listCapabilities())
}

export async function POST(request: Request) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, capabilitySchema)
  if (parsed.error) return parsed.error

  try {
    const capability = await createCapability(parsed.data.name, parsed.data.permissionIds ?? [])
    return NextResponse.json(capability, { status: 201 })
  } catch (error) {
    if (error instanceof CapabilityError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
