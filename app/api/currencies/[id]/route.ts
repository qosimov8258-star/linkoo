import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { currencyErrorResponse } from "@/app/api/currencies/schema"
import { nameField, parseBody, parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { deleteCurrency, getCurrency, updateCurrency } from "@/lib/currencies-repo"
import { editCurrency } from "@/lib/currency-rates-repo"
import { optionalRateValue } from "@/lib/currency-rates-schema"
import { dbErrorResponse } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Валюта не найдена" }

// "Изменить валюту" sends the name and, optionally, a new rate (recorded in the rate history).
// The rate is strict (lib/currency-rates-schema.ts): absent / null = unchanged; "" , 0, signs,
// hex, exponents and texts are refused (400), never stored as 0.
const currencyUpdateSchema = z.object({
  name: nameField("Укажите название валюты", 100),
  rate: optionalRateValue,
})

/** The refusal of a currency write, or a lock timeout / busy database, as JSON; null otherwise. */
function writeErrorResponse(error: unknown): NextResponse | null {
  return currencyErrorResponse(error) ?? dbErrorResponse(error)
}

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

  // "Изменить валюту": the name, and a new history row when the rate changed — one transaction
  // under the currencies lock, reading the code / rate / base of the locked row, so a parallel
  // edit or "Установить курс" is never undone by stale values.
  try {
    const result = await editCurrency(id, parsed.data.rate, async (current) => {
      const updated = await updateCurrency(id, { name: parsed.data.name, code: current.code.trim().toUpperCase(), rate: current.rate, isBase: current.isBase })
      return updated.ok
    })
    if (!result.ok) return NextResponse.json(NOT_FOUND, { status: 404 })
  } catch (error) {
    const response = writeErrorResponse(error)
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
    const response = writeErrorResponse(error)
    if (response) return response
    throw error
  }
}
