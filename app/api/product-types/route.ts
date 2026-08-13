import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createProductType, listProductTypes, parseProductTypeInput } from "@/lib/product-types-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listProductTypes())
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

  const input = parseProductTypeInput(body)
  if (!input) return NextResponse.json({ error: "Наименование и организация обязательны" }, { status: 400 })

  const type = createProductType(input)
  return NextResponse.json(type, { status: 201 })
}
