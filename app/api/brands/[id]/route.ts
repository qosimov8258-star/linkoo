import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteBrand, parseBrandInput, updateBrand } from "@/lib/brands-repo"

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

  const input = parseBrandInput(body)
  if (!input) return NextResponse.json({ error: "Наименование и организация обязательны" }, { status: 400 })

  const brand = updateBrand(id, input)
  if (!brand) return NextResponse.json({ error: "Бренд не найден" }, { status: 404 })
  return NextResponse.json(brand)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const ok = deleteBrand(id)
  if (!ok) return NextResponse.json({ error: "Бренд не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
