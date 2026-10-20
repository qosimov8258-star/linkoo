import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { deleteKpiTask, setKpiTaskActive, updateKpiTask } from "@/lib/kpi-tasks-repo"

// A PUT body of exactly `{ active: boolean }` is a toggle-only request; any
// other shape is treated as a full task update (mirrors the original
// hand-rolled branch: `Object.keys(value).length === 1 && typeof value.active === "boolean"`).
const kpiTaskActiveOnlySchema = z.object({ active: z.boolean() }).strict()
const kpiTaskFullSchema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  planType: z.string().optional(),
  clientType: z.string().trim().optional(),
  comment: z.string().optional(),
  active: z.boolean().optional(),
})
const kpiTaskPutSchema = z.union([kpiTaskActiveOnlySchema, kpiTaskFullSchema])

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, kpiTaskPutSchema)
  if (parsed.error) return parsed.error

  if (!("name" in parsed.data)) {
    const task = (await setKpiTaskActive(id, parsed.data.active))
    if (!task) return NextResponse.json({ error: "KPI задача не найдена" }, { status: 404 })
    return NextResponse.json(task)
  }

  const task = (await updateKpiTask(id, {
    name: parsed.data.name,
    planType: parsed.data.planType ?? "",
    clientType: parsed.data.clientType || "Для всех",
    comment: parsed.data.comment ?? "",
    active: parsed.data.active ?? true,
  }))
  if (!task) return NextResponse.json({ error: "KPI задача не найдена" }, { status: 404 })
  return NextResponse.json(task)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = (await deleteKpiTask(id))
  if (!ok) return NextResponse.json({ error: "KPI задача не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
