import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteRepricing, parseRepricingInput, updateRepricing } from "@/lib/repricings-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const input = parseRepricingInput(body, user.displayName)
  if (!input) return NextResponse.json({ error: "Прайс-лист и товар обязательны" }, { status: 400 })

  const repricing = updateRepricing(id, input)
  if (!repricing) return NextResponse.json({ error: "Переоценка не найдена" }, { status: 404 })
  return NextResponse.json(repricing)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const ok = deleteRepricing(id)
  if (!ok) return NextResponse.json({ error: "Переоценка не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
