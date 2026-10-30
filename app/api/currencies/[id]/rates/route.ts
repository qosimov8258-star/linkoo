import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getCurrency } from "@/lib/currencies-repo"
import { listCurrencyRates, setCurrencyRate } from "@/lib/currency-rates-repo"
import { setRateSchema } from "@/lib/currency-rates-schema"
import { dbErrorResponse } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Валюта не найдена" }

/** GET: "История обновления курса" of a currency, newest first (404 for an unknown currency). */
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseIdSegment((await params).id)
  if (id === null || !(await getCurrency(id))) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(await listCurrencyRates(id))
}

/** POST: "Установить курс" {rate}: strict rate (lib/currency-rates-schema.ts), 404 unknown, 409 base. */
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, setRateSchema)
  if (parsed.error) return parsed.error

  try {
    const result = await setCurrencyRate(id, parsed.data.rate)
    if (!result.ok) {
      return result.error === "is_base"
        ? NextResponse.json({ error: "Нельзя изменить курс основной валюты" }, { status: 409 })
        : NextResponse.json(NOT_FOUND, { status: 404 })
    }
  } catch (error) {
    const response = dbErrorResponse(error)
    if (response) return response
    throw error
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}
