import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { updateOrderTimeRestriction } from "@/lib/order-time-restrictions-repo"

const timeSchema = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Неверное время").nullable().optional()

const schema = z
  .object({
    status: z.enum(["1", "2", "3", "4"]),
    from: timeSchema,
    to: timeSchema,
    isAll: z.boolean(),
  })
  .refine((value) => (value.status !== "3" && value.status !== "4") || (Boolean(value.from) && Boolean(value.to)), { message: "Укажите начало и конец" })

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error

  const item = await updateOrderTimeRestriction(id, { status: parsed.data.status, from: parsed.data.from ?? null, to: parsed.data.to ?? null, isAll: parsed.data.isAll })
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}
