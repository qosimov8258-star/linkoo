import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteCashbox, getCashbox, parseCashboxInput, updateCashbox } from "@/lib/cashboxes-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const cashbox = getCashbox(id)
  if (!cashbox) return NextResponse.json({ error: "Касса не найдена" }, { status: 404 })
  return NextResponse.json(cashbox)
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const input = parseCashboxInput(body)
  if (!input) {
    return NextResponse.json({ error: "Название, валюта, кассир, тип оплаты и порядковый номер обязательны" }, { status: 400 })
  }

  const cashbox = updateCashbox(id, input)
  if (!cashbox) return NextResponse.json({ error: "Касса не найдена" }, { status: 404 })
  return NextResponse.json(cashbox)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const ok = deleteCashbox(id)
  if (!ok) return NextResponse.json({ error: "Касса не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
