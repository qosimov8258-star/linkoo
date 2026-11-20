import { NextResponse } from "next/server"
import { z } from "zod"

import { parseBody } from "@/lib/auth-request"
import { listReturnItemMarks, MAX_MARKS_PER_LINE, replaceReturnItemMarks, RETURN_MARK_TYPES } from "@/lib/client-return-marks-repo"
import { getCurrentUser } from "@/lib/current-user"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// The marking codes of one line of a client return (the card's «Список товаров» → green «+» / pencil):
// GET  → {marks: [{id, type: consumer|group|transport, code, createdAt}]} (Linko's order_return_product/<id>/get_marks/);
// PUT  {marks: [{type, code, createdAt?}]} → the line's codes become exactly these (Linko's add_marks, clear_other),
//      answered like GET. A manager (Linko lets anyone who sees the card save them).

type RouteParams = { params: Promise<{ id: string; itemId: string }> }

const NOT_FOUND = { error: "Возврат не найден" }
// A full line of long DataMatrix codes is bigger than the default JSON cap.
const MAX_BODY_BYTES = 1024 * 1024

const marksSchema = z.object({
  marks: z
    .array(
      z.object({
        type: z.enum(RETURN_MARK_TYPES as [string, ...string[]], { error: "Неверные данные" }),
        code: z.string({ error: "Неверные данные" }).trim().min(1, { error: "Неверные данные" }).max(500, { error: "Слишком длинное значение" }),
        // The scan moment: "YYYY-MM-DD HH:mm" from the dialog; seconds, fractions and an offset are taken too (Linko's
        // own created_date of copied codes).
        createdAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)?$/, { error: "Неверные данные" })
          .optional(),
      }),
    )
    .max(MAX_MARKS_PER_LINE, { error: "Слишком много значений" }),
})

async function ids(params: RouteParams["params"]) {
  const raw = await params
  return { id: routeId(raw.id), itemId: routeId(raw.itemId) }
}

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const { id, itemId } = await ids(params)
  const marks = id && itemId ? await listReturnItemMarks(id, itemId) : null
  if (!marks) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json({ marks })
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const { id, itemId } = await ids(params)
  if (!id || !itemId) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, marksSchema, MAX_BODY_BYTES)
  if (parsed.error) return parsed.error
  try {
    const marks = await replaceReturnItemMarks(
      id,
      itemId,
      parsed.data.marks.map((mark) => ({ type: mark.type as (typeof RETURN_MARK_TYPES)[number], code: mark.code, createdAt: mark.createdAt })),
    )
    if (!marks) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ marks })
  } catch (error) {
    return orderErrorResponse(error)
  }
}
