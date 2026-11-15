import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { dbId } from "@/lib/strict-number"
import { BUILDER_DATE_RANGES } from "@/lib/new-report-builder-types"
import {
  builderViewer,
  deleteNewReportBuilderSave,
  getNewReportBuilderSave,
  updateNewReportBuilderSave,
  type SaveChangeError,
} from "@/lib/new-report-builder-repo"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = "Отчет не найден"

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(255, "Не более 255 символов").optional(),
    dateRange: z.enum(BUILDER_DATE_RANGES).optional(),
    share: z
      .object({
        mode: z.enum(["users", "rights"]),
        ids: z.array(dbId()).max(10_000),
      })
      .nullable()
      .optional(),
  })
  .refine((value) => value.name !== undefined || value.dateRange !== undefined || value.share !== undefined, { message: "Неверные данные" })

function changeErrorResponse(error: SaveChangeError) {
  if (error === "forbidden") return NextResponse.json({ error: "У вас нет прав на это действие" }, { status: 403 })
  if (error === "unknown-users") return NextResponse.json({ error: "Пользователь не найден" }, { status: 400 })
  if (error === "unknown-rights") return NextResponse.json({ error: "Права доступа не найдены" }, { status: 400 })
  return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
}

// GET /api/new-report-builder-saves/[id] — one save the caller may see (?report=<id> of the constructor pages).
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const save = await getNewReportBuilderSave(id, builderViewer(user))
  if (!save) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  return NextResponse.json(save)
}

// PATCH /api/new-report-builder-saves/[id] {name?, dateRange?, share?} — «ИЗМЕНИЕ ТАБЛИЦЫ» (new name, period
// preset) and «ПОЛЬЗОВАТЕЛИ» (share {mode: users | rights, ids}; null = every user). Its author or an administrator.
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, patchSchema)
  if (parsed.error) return parsed.error

  const result = await updateNewReportBuilderSave(id, parsed.data, builderViewer(auth.user))
  if ("error" in result) return changeErrorResponse(result.error)
  return NextResponse.json(result.save)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const result = await deleteNewReportBuilderSave(id, builderViewer(auth.user))
  if ("error" in result) return changeErrorResponse(result.error)
  return NextResponse.json({ ok: true })
}
