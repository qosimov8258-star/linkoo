import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deletePriceList, parsePriceListInput, updatePriceList } from "@/lib/price-lists-repo"

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

  const input = parsePriceListInput(body)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const priceList = updatePriceList(id, input)
  if (!priceList) return NextResponse.json({ error: "Прайс-лист не найден" }, { status: 404 })
  return NextResponse.json(priceList)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const ok = deletePriceList(id)
  if (!ok) return NextResponse.json({ error: "Прайс-лист не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
