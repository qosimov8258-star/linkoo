import "server-only"

import { z } from "zod"

import { MAX_ID, MAX_MONEY } from "@/lib/finance/api"
import { parseAnyDate } from "@/lib/finance/dates"

// Request bodies of the "Баланс вансел" write routes
// (app/api/vansell-transactions/**). Dates are local Asia/Tashkent
// "YYYY-MM-DDTHH:mm" (datetime-local), "YYYY-MM-DD HH:mm" (demo payload) or a
// plain "YYYY-MM-DD"; the repo stores them as "YYYY-MM-DDTHH:mm".
// Writes must check the agent with isVansellAgent (lib/finance/entities.ts,
// 404 "Вансел не найден") and the currency with resolveCurrencyCode
// (lib/finance/context.ts, 400 "Валюта не найдена").

const localDateTime = z
  .string()
  .trim()
  .refine((value) => /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.test(value) && parseAnyDate(value) !== null, "YYYY-MM-DDTHH:mm")

/** A number or a numeric string (JSON bodies of older callers send ids / amounts as text). Booleans, arrays and null are rejected. */
const numeric = z.union([z.number(), z.string().trim().min(1).transform(Number)])

const employeeId = numeric.pipe(z.number().int().positive().max(MAX_ID))
const currency = z.string().trim().min(1).max(16)

/** POST /api/vansell-transactions — "Добавить" (kind add, +amount) / "Добавить расход" (kind expense, −amount). */
export const vansellTransactionCreateSchema = z
  .object({
    employeeId: employeeId.optional(),
    /** Legacy name of employeeId. */
    vanselId: employeeId.optional(),
    currency,
    amount: numeric.pipe(z.number().finite().positive().max(MAX_MONEY)),
    kind: z.enum(["add", "expense"]).default("add"),
    date: localDateTime.optional(),
    comment: z.string().trim().max(2000).optional(),
  })
  .refine((value) => value.employeeId !== undefined || value.vanselId !== undefined, { message: "employeeId", path: ["employeeId"] })
  .transform(({ vanselId, ...value }) => ({ ...value, employeeId: (value.employeeId ?? vanselId) as number }))

export type VansellTransactionCreateBody = z.infer<typeof vansellTransactionCreateSchema>

/** PUT /api/vansell-transactions/[id] — edit a manual ("Нет типа") movement; amount is signed as typed. */
export const vansellTransactionUpdateSchema = z.object({
  employeeId: employeeId.optional(),
  currency,
  amount: numeric.pipe(
    z
      .number()
      .finite()
      .refine((value) => value !== 0, "≠ 0")
      .refine((value) => Math.abs(value) <= MAX_MONEY, "≤ 1e13"),
  ),
  date: localDateTime.optional(),
  comment: z.string().trim().max(2000).optional(),
})

export type VansellTransactionUpdateBody = z.infer<typeof vansellTransactionUpdateSchema>

/** POST /api/vansell-transactions/limits — "Изменить лимит"; a blank limit ("" / null) coerces to 0 like the demo. */
const limit = z
  .union([z.number(), z.string(), z.null()])
  .transform((value) => (value === null || (typeof value === "string" && !value.trim()) ? 0 : Number(value)))
  .pipe(z.number().finite().min(0).max(MAX_MONEY))

export const vansellLimitsSchema = z.array(z.object({ employeeId, limit })).min(1)

export type VansellLimitsBody = z.infer<typeof vansellLimitsSchema>
