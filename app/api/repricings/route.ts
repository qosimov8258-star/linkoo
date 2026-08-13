import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createRepricing, listRepricings, parseRepricingInput } from "@/lib/repricings-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listRepricings())
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

  const input = parseRepricingInput(body, user.displayName)
  if (!input) return NextResponse.json({ error: "Прайс-лист и товар обязательны" }, { status: 400 })

  const repricing = createRepricing(input)
  return NextResponse.json(repricing, { status: 201 })
}
