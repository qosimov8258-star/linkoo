import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteKpiTask, getKpiTask, setKpiTaskActive, setKpiTaskLock, updateKpiTask } from "@/lib/kpi-tasks-repo"

// A PUT body of exactly `{ active: boolean }` is a toggle-only request; any
// other shape is treated as a full task update (mirrors the original
// hand-rolled branch: `Object.keys(value).length === 1 && typeof value.active === "boolean"`).
const kpiTaskActiveOnlySchema = z.object({ active: z.boolean() }).strict()
const kpiTaskLockSchema = z
  .object({
    lock: z.object({
      disableChange: z.boolean(),
      onlyForSystem: z.boolean(),
      visibleOnlyOperator: z.boolean(),
      operators: z.array(z.object({ id: z.number(), name: z.string() })),
    }),
  })
  .strict()
const kpiTaskFullSchema = z.object({
  name: z.string().trim().min(1),
  planType: z.string().optional(),
  clientType: z.string().trim().optional(),
  comment: z.string().optional(),
  active: z.boolean().optional(),
  detail: z.record(z.string(), z.unknown()).nullable().optional(),
  startDate: z.string().nullable().optional(),
  tillDate: z.string().nullable().optional(),
})
const kpiTaskPutSchema = z.union([kpiTaskActiveOnlySchema, kpiTaskLockSchema, kpiTaskFullSchema])

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, kpiTaskPutSchema)
  if (parsed.error) return parsed.error

  if ("lock" in parsed.data) {
    const task = await setKpiTaskLock(id, parsed.data.lock)
    if (!task) return NextResponse.json({ error: "KPI задача не найдена" }, { status: 404 })
    return NextResponse.json(task)
  }

  if (!("name" in parsed.data)) {
    const task = (await setKpiTaskActive(id, parsed.data.active))
    if (!task) return NextResponse.json({ error: "KPI задача не найдена" }, { status: 404 })
    return NextResponse.json(task)
  }

  // "Заблокировать изменение" (disable_change) of the lock dialog: a locked KPI cannot be edited.
  const existing = await getKpiTask(id)
  if (existing?.detail && (existing.detail as Record<string, unknown>).disable_change === true) {
    return NextResponse.json({ error: "У вас нет доступа" }, { status: 403 })
  }

  const task = (await updateKpiTask(id, {
    name: parsed.data.name,
    planType: parsed.data.planType ?? "",
    clientType: parsed.data.clientType || "Для всех",
    comment: parsed.data.comment ?? "",
    active: parsed.data.active ?? true,
    detail: parsed.data.detail,
    startDate: parsed.data.startDate,
    tillDate: parsed.data.tillDate,
  }))
  if (!task) return NextResponse.json({ error: "KPI задача не найдена" }, { status: 404 })
  return NextResponse.json(task)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteKpiTask(id))
  if (!ok) return NextResponse.json({ error: "KPI задача не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
