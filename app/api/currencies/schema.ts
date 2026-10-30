import { NextResponse } from "next/server"
import { z } from "zod"

import { nameField } from "@/lib/auth-request"
import { CurrencyError, type CurrencyInput } from "@/lib/currencies-repo"
import { parseRate, RATE_MAX } from "@/lib/currency-rates-schema"

export const MAX_RATE = RATE_MAX

/** {name, code, rate, isBase} → CurrencyInput. The rate is required and must be a strict
 * number in (0, 1e9] (lib/currency-rates-schema.ts parseRate: no "", hex, exponent or sign)
 * unless the currency is the base one (rate 1). */
export const currencySchema = z
  .object({
    name: nameField("Укажите название валюты", 100),
    code: z
      .string({ error: "Укажите код валюты" })
      .transform((value) => value.normalize("NFKC").trim().toUpperCase())
      .pipe(z.string().regex(/^[\p{L}\p{N}]{2,10}$/u, { error: "Код валюты должен содержать от 2 до 10 букв или цифр" })),
    rate: z.union([z.number(), z.string()], { error: "Курс должен быть положительным числом" }).nullable().optional(),
    isBase: z.boolean().optional(),
  })
  .transform((value, ctx): CurrencyInput => {
    const isBase = value.isBase === true
    if (isBase) return { name: value.name, code: value.code, rate: 1, isBase }
    const parsed = parseRate(value.rate)
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.error, path: ["rate"] })
      return z.NEVER
    }
    return { name: value.name, code: value.code, rate: parsed.rate, isBase }
  })

export function currencyErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof CurrencyError)) return null
  return NextResponse.json({ error: error.message, ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
}
