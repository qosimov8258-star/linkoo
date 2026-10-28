import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { DOC_DATE_INVALID, docDateError } from "@/lib/document-dates"
import { orderTimeRestrictionResponse } from "@/lib/order-time-restrictions-guard"
import { orderErrorResponse, orderPatchSchema as baseOrderPatchSchema, routeId } from "@/lib/orders-api"
import { MAX_MONEY, deleteOrder, getOrder, getOrderClientDebt, updateOrder } from "@/lib/orders-repo"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Заказ не найден" }

/** "YYYY-MM-DD" that is a real calendar day (2026-02-31 is not). */
function isCalendarDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const date = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day
}

/** The error key of a document day / moment ("YYYY-MM-DD[ HH:MM[:SS]]") under lib/document-dates.ts, or null. */
function dayError(value: string, allowFuture: boolean): string | null {
  if (!isCalendarDay(value.slice(0, 10))) return DOC_DATE_INVALID
  return docDateError(value.replace(" ", "T"), { allowFuture })
}

/** A real calendar day of a sane year, or ""; `future` allows a day after today. */
const isoDay = (future: boolean) =>
  z.union([
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: DOC_DATE_INVALID })
      .superRefine((value, ctx) => {
        const error = dayError(value, future)
        if (error) ctx.addIssue({ code: "custom", message: error })
      }),
    z.literal(""),
  ])
const moneyValue = (min: number) => z.number().finite().min(min, { error: "Слишком маленькое значение" }).max(MAX_MONEY, { error: "Слишком большое значение" })

// The shared patch schema plus the reference-snapshot fields the order card edits.
const orderPatchSchema = baseOrderPatchSchema.extend({
  expeditor: z.string().trim().max(200).optional(),
  payMethod: z.enum(["cash", "bank", ""]).optional(),
  payTypeName: z.string().trim().max(100).optional(),
  stockName: z.string().trim().max(200).optional(),
  branchName: z.string().trim().max(200).optional(),
  transportNumber: z.string().trim().max(100).optional(),
  // The expected payment day may be in the future; the acceptance day may not.
  dueDate: isoDay(true).optional(),
  acceptedDate: isoDay(false).optional(),
  paidAmount: moneyValue(0).optional(),
  orderBalance: moneyValue(-MAX_MONEY).optional(),
  invoiceContract: z.string().trim().max(200).optional(),
  createdAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/, { error: DOC_DATE_INVALID })
    .superRefine((value, ctx) => {
      const error = dayError(value, false)
      if (error) ctx.addIssue({ code: "custom", message: error })
    })
    .optional(),
})

// GET /api/orders/[id] → Order + clientDebt {operative, actual} (the client's ledger balance by creation / realization).
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const id = routeId((await params).id)
  const order = id ? await getOrder(id) : null
  if (!order) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json({ ...order, clientDebt: await getOrderClientDebt(order) })
}

// PATCH /api/orders/[id] — status (known statuses and allowed transitions only,
// 409 otherwise), client, warehouse, people, payment terms… Доставлено /
// Отменен orders are final (only payment date / invoice details change).
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const blocked = await orderTimeRestrictionResponse("edit", auth.user)
  if (blocked) return blocked

  const id = routeId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, orderPatchSchema)
  if (parsed.error) return parsed.error

  const { balance: _balance, negative: _negative, ...patch } = parsed.data
  void _balance
  void _negative
  if (!Object.values(patch).some((value) => value !== undefined)) {
    return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 })
  }

  try {
    const order = await updateOrder(id, patch, auth.user)
    if (!order) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(order)
  } catch (error) {
    return orderErrorResponse(error)
  }
}

/** Removes an order that never left the warehouse (lib/orders-repo.ts deleteOrder, one transaction):
 * a shipped / delivered order can only be cancelled (409), and one with live payments or returns
 * is refused (409 with the usage list). */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const blocked = await orderTimeRestrictionResponse("edit", auth.user)
  if (blocked) return blocked

  const id = routeId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    if (!(await deleteOrder(id))) return NextResponse.json(NOT_FOUND, { status: 404 })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return orderErrorResponse(error)
  }
}
