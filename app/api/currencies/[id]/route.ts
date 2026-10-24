import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteCurrency, getCurrency, updateCurrency } from "@/lib/currencies-repo"
import { setCurrencyRate } from "@/lib/currency-rates-repo"

type RouteParams = { params: Promise<{ id: string }> }

const currencyUpdateSchema = z.object({
  name: z.string({ error: "Обязательное поле" }).trim().min(1, "Обязательное поле").max(255),
  rate: z.preprocess((value) => (value === "" || value === undefined ? undefined : typeof value === "string" ? Number(value.replace(/\s/g, "").replace(",", ".")) : value), z.number().positive("Введите число больше 0").max(1_000_000_000).optional()),
})

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const id = Number((await params).id)
  const currency = (await getCurrency(id))
  if (!currency) return NextResponse.json({ error: "Валюта не найдена" }, { status: 404 })
  return NextResponse.json(currency)
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, currencyUpdateSchema)
  if (parsed.error) return parsed.error

  const existing = await getCurrency(id)
  if (!existing) return NextResponse.json({ error: "Валюта не найдена" }, { status: 404 })

  // "Изменить валюту": the name, and a new history row when the rate changed.
  await updateCurrency(id, { name: parsed.data.name, code: existing.code, rate: existing.rate, isBase: existing.isBase })
  if (!existing.isBase && parsed.data.rate !== undefined && parsed.data.rate !== existing.rate) await setCurrencyRate(id, parsed.data.rate)
  return NextResponse.json(await getCurrency(id))
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const result = (await deleteCurrency(id))
  if (result === "not_found") return NextResponse.json({ error: "Валюта не найдена" }, { status: 404 })
  if (result === "is_base") return NextResponse.json({ error: "Нельзя удалить базовую валюту" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
