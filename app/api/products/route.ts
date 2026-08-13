import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createProduct, listProducts, parseProductInput } from "@/lib/products-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listProducts())
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

  const input = parseProductInput(body)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const product = createProduct(input)
  return NextResponse.json(product, { status: 201 })
}
