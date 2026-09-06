import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteCurrency, getCurrency, updateCurrency, type CurrencyInput } from "@/lib/currencies-repo"

type RouteParams = { params: Promise<{ id: string }> }

const currencySchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  rate: z.coerce.number().catch(0),
  isBase: z.boolean().optional(),
})

function toCurrencyInput(data: z.infer<typeof currencySchema>): CurrencyInput {
  const isBase = data.isBase === true
  const rate = isBase ? 1 : Math.max(0, data.rate)
  return { name: data.name, code: data.code.toUpperCase(), rate, isBase }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const currency = (await getCurrency(id))
  if (!currency) return NextResponse.json({ error: "Валюта не найдена" }, { status: 404 })
  return NextResponse.json(currency)
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, currencySchema)
  if (parsed.error) return parsed.error

  const input = toCurrencyInput(parsed.data)

  const result = (await updateCurrency(id, input))
  if (!result.ok) return NextResponse.json({ error: "Валюта не найдена" }, { status: 404 })
  return NextResponse.json(result.currency)
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
