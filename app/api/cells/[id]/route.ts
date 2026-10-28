import { NextResponse } from "next/server"

import { cellBodySchema } from "@/lib/cells-api"
import { deleteCell, getCell, updateCell } from "@/lib/cells-repo"
import { getCurrentUser } from "@/lib/current-user"
import { dictionaryWrite, parseDictionaryId } from "@/lib/dictionaries-schema"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Ячейка не найдена" }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseDictionaryId((await params).id)
  const row = id ? await getCell(id) : null
  if (!row) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(row)
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseDictionaryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, cellBodySchema)
  if (parsed.error) return parsed.error
  const { name, barcode, cellTypeId } = parsed.data
  return dictionaryWrite(async () => {
    const row = await updateCell(id, { name, barcode: barcode ?? "", cellTypeId: cellTypeId ?? null })
    return row ? NextResponse.json(row) : NextResponse.json(NOT_FOUND, { status: 404 })
  })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseDictionaryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  return dictionaryWrite(async () => ((await deleteCell(id)) ? NextResponse.json({ ok: true }) : NextResponse.json(NOT_FOUND, { status: 404 })))
}
