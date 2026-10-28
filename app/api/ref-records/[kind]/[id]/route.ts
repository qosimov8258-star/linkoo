import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteRecord, getRecord, isRefKind, updateRecord } from "@/lib/ref-records-repo"

type Params = { params: Promise<{ kind: string; id: string }> }

async function guard(params: Params["params"]) {
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 }) }
  const { kind, id } = await params
  if (!isRefKind(kind)) return { error: NextResponse.json({ error: "Неизвестный раздел" }, { status: 404 }) }
  return { kind, id }
}

export async function GET(_request: Request, { params }: Params) {
  const g = await guard(params)
  if ("error" in g) return g.error
  const record = await getRecord(g.kind, g.id)
  return record ? NextResponse.json(record.data) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}

export async function PUT(request: Request, { params }: Params) {
  const g = await guard(params)
  if ("error" in g) return g.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Некорректные данные" }, { status: 400 })
  const updated = await updateRecord(g.kind, g.id, body)
  return updated ? NextResponse.json(updated.data) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}

export async function DELETE(_request: Request, { params }: Params) {
  const g = await guard(params)
  if ("error" in g) return g.error
  return (await deleteRecord(g.kind, g.id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}
