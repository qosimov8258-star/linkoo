import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteCurrency, getCurrency, updateCurrency, type CurrencyInput } from "@/lib/currencies-repo"

type RouteParams = { params: Promise<{ id: string }> }

function parseCurrencyInput(body: unknown): CurrencyInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>

  const name = typeof value.name === "string" ? value.name.trim() : ""
  const code = typeof value.code === "string" ? value.code.trim().toUpperCase() : ""
  if (!name || !code) return null

  const isBase = value.isBase === true
  const rateRaw = typeof value.rate === "number" ? value.rate : Number(value.rate)
  const rate = isBase ? 1 : Math.max(0, Number.isFinite(rateRaw) ? rateRaw : 0)

  return { name, code, rate, isBase }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const currency = getCurrency(id)
  if (!currency) return NextResponse.json({ error: "Валюта не найдена" }, { status: 404 })
  return NextResponse.json(currency)
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const input = parseCurrencyInput(body)
  if (!input) return NextResponse.json({ error: "Название и код обязательны" }, { status: 400 })

  const result = updateCurrency(id, input)
  if (!result.ok) return NextResponse.json({ error: "Валюта не найдена" }, { status: 404 })
  return NextResponse.json(result.currency)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const result = deleteCurrency(id)
  if (result === "not_found") return NextResponse.json({ error: "Валюта не найдена" }, { status: 404 })
  if (result === "is_base") return NextResponse.json({ error: "Нельзя удалить базовую валюту" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
