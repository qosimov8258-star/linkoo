import { NextRequest, NextResponse } from "next/server"
import { releaseClientAccount } from "@/lib/financial-accounts-repo"

import { parseBody, parseId } from "@/lib/auth-request"
import { clientErrorResponse, clientInputOf, clientSchema } from "@/lib/client-schema"
import { deleteClient, getClient, updateClient } from "@/lib/clients-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Клиент не найден" }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const id = parseId((await params).id)
  const client = id ? await getClient(id) : null
  if (!client) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(client)
}

// PUT /api/clients/[id] — full update; an omitted `balance` keeps the opening
// balance (null clears it). A rename follows to the documents of the client.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, clientSchema)
  if (parsed.error) return parsed.error

  try {
    const client = await updateClient(id, clientInputOf(parsed.data), auth.user)
    if (!client) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(client)
  } catch (error) {
    return clientErrorResponse(error)
  }
}

// DELETE /api/clients/[id] — 409 {error, usage} while documents reference the client.
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    await releaseClientAccount(id)
    const ok = await deleteClient(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return clientErrorResponse(error)
  }
}
