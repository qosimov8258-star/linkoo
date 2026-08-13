import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteRawMaterial, parseRawMaterialInput, updateRawMaterial } from "@/lib/raw-materials-repo"

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

  const input = parseRawMaterialInput(body)
  if (!input) return NextResponse.json({ error: "Наименование и мера обязательны" }, { status: 400 })

  const material = updateRawMaterial(id, input)
  if (!material) return NextResponse.json({ error: "Сырьё не найдено" }, { status: 404 })
  return NextResponse.json(material)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const ok = deleteRawMaterial(id)
  if (!ok) return NextResponse.json({ error: "Сырьё не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
