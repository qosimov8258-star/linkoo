import { NextResponse } from "next/server"
import { z } from "zod"

import { nameField } from "@/lib/auth-request"
import { CurrencyError, type CurrencyInput } from "@/lib/currencies-repo"

export const MAX_RATE = 1e9

/** {name, code, rate, isBase} → CurrencyInput. The rate is required and must be
 * a finite number in (0, 1e9] unless the currency is the base one (rate 1). */
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
    const raw = value.rate
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
      ctx.addIssue({ code: "custom", message: "Укажите курс валюты", path: ["rate"] })
      return z.NEVER
    }
    const rate = typeof raw === "number" ? raw : Number(raw.replace(/[\s ]/g, "").replace(",", "."))
    if (!Number.isFinite(rate) || rate <= 0) {
      ctx.addIssue({ code: "custom", message: "Курс должен быть положительным числом", path: ["rate"] })
      return z.NEVER
    }
    if (rate > MAX_RATE) {
      ctx.addIssue({ code: "custom", message: "Курс слишком большой", path: ["rate"] })
      return z.NEVER
    }
    return { name: value.name, code: value.code, rate, isBase }
  })

export function currencyErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof CurrencyError)) return null
  return NextResponse.json({ error: error.message, ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
}
