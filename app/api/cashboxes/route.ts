import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createCashbox, listCashboxes, parseCashboxInput } from "@/lib/cashboxes-repo"

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const search = request.nextUrl.searchParams.get("q") ?? undefined
  return NextResponse.json(listCashboxes(search))
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

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

  const cashbox = createCashbox(input)
  return NextResponse.json(cashbox, { status: 201 })
}
