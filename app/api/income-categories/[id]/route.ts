import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteIncomeCategory, parseIncomeCategoryInput, updateIncomeCategory } from "@/lib/income-categories-repo"

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

  const input = parseIncomeCategoryInput(body)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const category = updateIncomeCategory(id, input)
  if (!category) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })
  return NextResponse.json(category)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const ok = deleteIncomeCategory(id)
  if (!ok) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
