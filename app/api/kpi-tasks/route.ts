import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createKpiTask, listKpiTasks } from "@/lib/kpi-tasks-repo"

const kpiTaskSchema = z.object({
  name: z.string().trim().min(1),
  planType: z.string().optional(),
  clientType: z.string().trim().optional(),
  comment: z.string().optional(),
  active: z.boolean().optional(),
  detail: z.record(z.string(), z.unknown()).nullable().optional(),
  startDate: z.string().nullable().optional(),
  tillDate: z.string().nullable().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listKpiTasks()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, kpiTaskSchema)
  if (parsed.error) return parsed.error

  const task = (await createKpiTask({
    name: parsed.data.name,
    planType: parsed.data.planType ?? "",
    clientType: parsed.data.clientType || "Для всех",
    comment: parsed.data.comment ?? "",
    active: parsed.data.active ?? true,
    detail: parsed.data.detail,
    startDate: parsed.data.startDate,
    tillDate: parsed.data.tillDate,
  }))
  return NextResponse.json(task, { status: 201 })
}
