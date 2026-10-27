import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { currencyErrorResponse } from "@/app/api/currencies/schema"
import { parseBody, parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { deleteCurrency, getCurrency, updateCurrency } from "@/lib/currencies-repo"
import { requireRole } from "@/lib/rbac"
import { setCurrencyRate } from "@/lib/currency-rates-repo"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Валюта не найдена" }

// "Изменить валюту" sends the name and, optionally, a new rate (recorded in the rate history).
const currencyUpdateSchema = z.object({
  name: z.string({ error: "Обязательное поле" }).trim().min(1, "Обязательное поле").max(255),
  rate: z.preprocess((value) => (value === "" || value === undefined ? undefined : typeof value === "string" ? Number(value.replace(/\s/g, "").replace(",", ".")) : value), z.number().positive("Введите число больше 0").max(1_000_000_000).optional()),
})

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const id = parseId((await params).id)
  const currency = id ? await getCurrency(id) : null
  if (!currency) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(currency)
}

// PUT /api/currencies/[id] — 409 for a code another currency has, or for a code
// change while the currency is in use; 400 for an invalid rate.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, currencyUpdateSchema)
  if (parsed.error) return parsed.error

  const existing = await getCurrency(id)
  if (!existing) return NextResponse.json(NOT_FOUND, { status: 404 })

  // "Изменить валюту": the name, and a new history row when the rate changed.
  try {
    await updateCurrency(id, { name: parsed.data.name, code: existing.code, rate: existing.rate, isBase: existing.isBase })
    if (!existing.isBase && parsed.data.rate !== undefined && parsed.data.rate !== existing.rate) await setCurrencyRate(id, parsed.data.rate)
  } catch (error) {
    const response = currencyErrorResponse(error)
    if (response) return response
    throw error
  }
  return NextResponse.json(await getCurrency(id))
}

// DELETE /api/currencies/[id] — 409 for the base currency and, with the usage
// list, while cashboxes, branches, price lists, payments or documents use it.
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const result = await deleteCurrency(id)
    if (result === "not_found") return NextResponse.json(NOT_FOUND, { status: 404 })
    if (result === "is_base") return NextResponse.json({ error: "Нельзя удалить базовую валюту" }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = currencyErrorResponse(error)
    if (response) return response
    throw error
  }
}
