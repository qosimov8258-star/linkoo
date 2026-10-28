import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createRecord, isRefKind, listRecords } from "@/lib/ref-records-repo"

type Params = { params: Promise<{ kind: string }> }

// GET /api/ref-records/<kind> → rows of a "Продажи" list page; POST creates a row (body = the page's row shape).
export async function GET(_request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const { kind } = await params
  if (!isRefKind(kind)) return NextResponse.json({ error: "Неизвестный раздел" }, { status: 404 })
  return NextResponse.json((await listRecords(kind)).map((record) => record.data))
}

export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const { kind } = await params
  if (!isRefKind(kind)) return NextResponse.json({ error: "Неизвестный раздел" }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Некорректные данные" }, { status: 400 })
  const { id: bodyId, ...data } = body
  const created = await createRecord(kind, data, bodyId === undefined || bodyId === null ? undefined : String(bodyId))
  return NextResponse.json(created.data, { status: 201 })
}
