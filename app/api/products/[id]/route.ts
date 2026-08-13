import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteProduct, parseProductInput, updateProduct } from "@/lib/products-repo"

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

  const input = parseProductInput(body)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const product = updateProduct(id, input)
  if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
  return NextResponse.json(product)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const ok = deleteProduct(id)
  if (!ok) return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
