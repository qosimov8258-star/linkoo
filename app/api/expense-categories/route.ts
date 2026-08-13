import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createExpenseCategory, listExpenseCategories, parseExpenseCategoryInput } from "@/lib/expense-categories-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listExpenseCategories())
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

  const input = parseExpenseCategoryInput(body)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const category = createExpenseCategory(input)
  return NextResponse.json(category, { status: 201 })
}
