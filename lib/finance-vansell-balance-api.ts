import "server-only"

import { z } from "zod"

import { parseAnyDate } from "@/lib/finance/dates"

// Request bodies of the "Баланс вансел" write routes
// (app/api/vansell-transactions/**). Dates are local Asia/Tashkent
// "YYYY-MM-DDTHH:mm" (datetime-local), "YYYY-MM-DD HH:mm" (demo payload) or a
// plain "YYYY-MM-DD"; the repo stores them as "YYYY-MM-DDTHH:mm".

const localDateTime = z
  .string()
  .trim()
  .refine((value) => /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.test(value) && parseAnyDate(value) !== null, "YYYY-MM-DDTHH:mm")

/** A number or a numeric string (JSON bodies of older callers send ids / amounts as text). Booleans, arrays and null are rejected. */
const numeric = z.union([z.number(), z.string().trim().min(1).transform(Number)])

const employeeId = numeric.pipe(z.number().int().positive())
const currency = z.string().trim().min(1).max(16)

/** POST /api/vansell-transactions — "Добавить" (kind add, +amount) / "Добавить расход" (kind expense, −amount). */
export const vansellTransactionCreateSchema = z
  .object({
    employeeId: employeeId.optional(),
    /** Legacy name of employeeId. */
    vanselId: employeeId.optional(),
    currency,
    amount: numeric.pipe(z.number().finite().positive()),
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
      .refine((value) => value !== 0, "≠ 0"),
  ),
  date: localDateTime.optional(),
  comment: z.string().trim().max(2000).optional(),
})

export type VansellTransactionUpdateBody = z.infer<typeof vansellTransactionUpdateSchema>

/** POST /api/vansell-transactions/limits — "Изменить лимит"; a blank limit ("" / null) coerces to 0 like the demo. */
const limit = z
  .union([z.number(), z.string(), z.null()])
  .transform((value) => (value === null || (typeof value === "string" && !value.trim()) ? 0 : Number(value)))
  .pipe(z.number().finite().min(0))

export const vansellLimitsSchema = z.array(z.object({ employeeId, limit })).min(1)

export type VansellLimitsBody = z.infer<typeof vansellLimitsSchema>
