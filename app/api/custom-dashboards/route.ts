import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createCustomDashboard, listCustomDashboards } from "@/lib/custom-dashboards-repo"

const customDashboardSchema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listCustomDashboards()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, customDashboardSchema)
  if (parsed.error) return parsed.error

  const item = (await createCustomDashboard(parsed.data))
  return NextResponse.json(item, { status: 201 })
}
