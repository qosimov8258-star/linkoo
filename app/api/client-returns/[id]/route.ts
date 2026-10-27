import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { clientReturnActionSchema, clientReturnUpdateSchema } from "@/lib/client-returns-api"
import { acceptClientReturns, cancelClientReturn, getClientReturn, unacceptClientReturn, updateClientReturn } from "@/lib/client-returns-repo"
import { getCurrentUser } from "@/lib/current-user"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Возврат не найден" }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = routeId((await params).id)
  const row = id ? await getClientReturn(id) : null
  if (!row) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(row)
}

// PUT /api/client-returns/[id] — edits a pending return (409 once accepted / cancelled).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = routeId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, clientReturnUpdateSchema)
  if (parsed.error) return parsed.error
  try {
    const row = await updateClientReturn(id, parsed.data, auth.user)
    if (!row) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(row)
  } catch (error) {
    return orderErrorResponse(error)
  }
}

// PATCH /api/client-returns/[id] {action} — "accept" (Принять на склад), "unaccept" (Отменить
// приемку: back to pending) or "cancel"; the same rules as the POST …/accept|unaccept|cancel routes.
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = routeId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, clientReturnActionSchema)
  if (parsed.error) return parsed.error
  try {
    const action = parsed.data.action
    const row =
      action === "accept"
        ? (await acceptClientReturns([id], auth.user))[0] ?? null
        : action === "unaccept"
          ? await unacceptClientReturn(id, auth.user)
          : await cancelClientReturn(id, auth.user)
    if (!row) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(row)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
