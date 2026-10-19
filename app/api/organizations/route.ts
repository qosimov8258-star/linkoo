import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createOrganization, listOrganizations } from "@/lib/organizations-repo"

const organizationSchema = z.object({
  name: z.string().trim().min(1),
  limitByDebt: z.boolean().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listOrganizations()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, organizationSchema)
  if (parsed.error) return parsed.error

  const organization = (await createOrganization({ name: parsed.data.name, limitByDebt: parsed.data.limitByDebt ?? false }))
  return NextResponse.json(organization, { status: 201 })
}
