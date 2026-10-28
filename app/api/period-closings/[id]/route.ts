import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { updatePeriodClosing } from "@/lib/period-closings-repo"

const schema = z
  .object({
    isAuto: z.boolean(),
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Неверная дата").nullable().optional(),
    days: z.number().int().min(0, "Количество дней не может быть отрицательным").max(3650, "Слишком большое количество дней").optional(),
  })
  .refine((value) => (value.isAuto ? value.days !== undefined : Boolean(value.date)), { message: "Заполните обязательное поле" })

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error

  const item = await updatePeriodClosing(id, { isAuto: parsed.data.isAuto, date: parsed.data.date ?? null, days: parsed.data.days ?? 0 })
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}
