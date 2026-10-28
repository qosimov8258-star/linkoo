import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listCurrencyRates, setCurrencyRate } from "@/lib/currency-rates-repo"
import { setRateSchema } from "@/lib/currency-rates-schema"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

/** GET: "История обновления курса" of a currency, newest first. */
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listCurrencyRates(Number((await params).id)))
}

/** POST: "Установить курс". */
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, setRateSchema)
  if (parsed.error) return parsed.error

  const result = await setCurrencyRate(Number((await params).id), parsed.data.rate)
  if (!result.ok) {
    return result.error === "is_base"
      ? NextResponse.json({ error: "Нельзя изменить курс основной валюты" }, { status: 409 })
      : NextResponse.json({ error: "Валюта не найдена" }, { status: 404 })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}
