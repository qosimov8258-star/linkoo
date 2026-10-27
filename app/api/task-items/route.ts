import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { createTaskItem, employeeIdForLogin, listTaskItems } from "@/lib/task-items-repo"
import { parseJsonBody } from "@/lib/validation"

const csv = (value: string | null) => (value ? value.split(",").map(Number).filter((n) => Number.isInteger(n)) : undefined)

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const p = new URL(request.url).searchParams
  const data = await listTaskItems({
    status: p.get("status") || undefined,
    search: p.get("search") || undefined,
    responsibleUser: csv(p.get("responsible_user")),
    createdBy: csv(p.get("created_by")),
    market: csv(p.get("market")),
    beginDate: p.get("begin_date") || undefined,
    endDate: p.get("end_date") || undefined,
    beginTaskDate: p.get("begin_task_date") || undefined,
    endTaskDate: p.get("end_task_date") || undefined,
    page: Number(p.get("page")) || 1,
    pageSize: Number(p.get("page_size")) || 25,
  })
  return NextResponse.json(data)
}

export const taskItemSchema = z.object({
  title: z.string().trim().min(1),
  market: z.number().int(),
  responsibleUser: z.number().int(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hasPlanRepetition: z.boolean().optional(),
  planFrequency: z.number().int().optional(),
  planRepetition: z.number().int().min(1).max(100).optional(),
})

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, taskItemSchema)
  if (parsed.error) return parsed.error
  const by = await employeeIdForLogin(auth.user.username)
  return NextResponse.json(await createTaskItem(parsed.data, by), { status: 201 })
}
