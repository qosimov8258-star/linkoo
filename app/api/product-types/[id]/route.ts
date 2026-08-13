import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteProductType, parseProductTypeInput, updateProductType } from "@/lib/product-types-repo"

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

  const input = parseProductTypeInput(body)
  if (!input) return NextResponse.json({ error: "Наименование и организация обязательны" }, { status: 400 })

  const type = updateProductType(id, input)
  if (!type) return NextResponse.json({ error: "Тип продукта не найден" }, { status: 404 })
  return NextResponse.json(type)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const ok = deleteProductType(id)
  if (!ok) return NextResponse.json({ error: "Тип продукта не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
