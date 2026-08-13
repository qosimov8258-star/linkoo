import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createPriceList, listPriceLists, parsePriceListInput } from "@/lib/price-lists-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listPriceLists())
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const input = parsePriceListInput(body)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const priceList = createPriceList(input)
  return NextResponse.json(priceList, { status: 201 })
}
