import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createCurrency, listCurrencies, type CurrencyInput } from "@/lib/currencies-repo"

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

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listCurrencies()))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, currencySchema)
  if (parsed.error) return parsed.error

  const input = toCurrencyInput(parsed.data)

  try {
    const currency = (await createCurrency(input))
    return NextResponse.json(currency, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Валюта с таким кодом уже существует" }, { status: 409 })
  }
}
