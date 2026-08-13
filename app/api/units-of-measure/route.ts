import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createUnitOfMeasure, listUnitsOfMeasure, parseUnitOfMeasureInput } from "@/lib/units-of-measure-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listUnitsOfMeasure())
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

  const input = parseUnitOfMeasureInput(body)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const unit = createUnitOfMeasure(input)
  return NextResponse.json(unit, { status: 201 })
}
