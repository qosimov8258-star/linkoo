import { NextResponse } from "next/server"

import { integrationSchema } from "@/lib/integrations-schema"
import { createIntegration, listIntegrations } from "@/lib/integrations-repo"
import { requirePermission, requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

function intParam(value: string | null): number | null {
  const parsed = Number(value)
  return value && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

// An integration row holds the token of the external service (a secret), so even reading the
// list needs the settings permission that changes it: administrators, role-only managers and the
// access rights that grant settings.manage. Everybody else gets 403, also for one row ([id]).
export async function GET(request: Request) {
  const auth = await requirePermission("settings.manage")
  if ("error" in auth) return auth.error
  const params = new URL(request.url).searchParams
  const pageSize = Math.min(2000, intParam(params.get("pageSize")) ?? 25)
  return NextResponse.json(
    await listIntegrations({
      isActive: params.get("is_active") !== "false",
      search: params.get("search") ?? "",
      type: params.get("type") ?? "",
      userId: intParam(params.get("user")),
      extraUserId: intParam(params.get("extra_user")),
      page: intParam(params.get("page")) ?? 1,
      pageSize,
    }),
  )
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, integrationSchema)
  if (parsed.error) return parsed.error
  return NextResponse.json(await createIntegration(parsed.data), { status: 201 })
}
