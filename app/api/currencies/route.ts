import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createCurrency, listCurrencies, type CurrencyInput } from "@/lib/currencies-repo"

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

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listCurrencies())
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const input = parseCurrencyInput(body)
  if (!input) return NextResponse.json({ error: "Название и код обязательны" }, { status: 400 })

  try {
    const currency = createCurrency(input)
    return NextResponse.json(currency, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Валюта с таким кодом уже существует" }, { status: 409 })
  }
}
