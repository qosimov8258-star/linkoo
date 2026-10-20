import "server-only"

import { z } from "zod"

import { parseAnyDate } from "@/lib/finance/dates"

// Request bodies of the "Баланс сотрудников" write route
// (app/api/employee-balance-transactions). Dates are local Asia/Tashkent
// "YYYY-MM-DDTHH:mm" (datetime-local), "YYYY-MM-DD HH:mm" (demo payload) or a
// plain "YYYY-MM-DD"; the repo stores them as "YYYY-MM-DDTHH:mm".
// Validation messages are Russian i18n keys (the dialog shows them with t()).

const REQUIRED = "Обязательное поле"
const AMOUNT = "Введите сумму больше нуля"
const CURRENCY = "Выберите валюту"
const DATE = "Неверная дата"

const localDateTime = z
  .string({ error: DATE })
  .trim()
  .refine((value) => /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.test(value) && parseAnyDate(value) !== null, DATE)

/** A number or a numeric string; booleans, arrays and null are rejected (z.coerce would turn them into 1 / 0). */
const numeric = (message: string) => z.union([z.number(), z.string().trim().min(1).transform(Number)], { error: message })

/** Ledger types this page writes: "Зачислить" / "Списать" = none_type
 * (column "Коректировки"); a fine = penalty (column "Штрафы", always
 * a minus). Salary / KPI accruals come from salary planning, not from here. */
export const EMPLOYEE_BALANCE_WRITE_TYPES = ["none_type", "penalty"] as const

/** POST /api/employee-balance-transactions — kind add (+amount) / expense (−amount). */
export const employeeBalanceTransactionSchema = z.object({
  employeeId: numeric(REQUIRED).pipe(z.number({ error: REQUIRED }).int(REQUIRED).positive(REQUIRED).max(2_147_483_647, REQUIRED)),
  kind: z.enum(["add", "expense"], { error: REQUIRED }),
  type: z.enum(EMPLOYEE_BALANCE_WRITE_TYPES, { error: REQUIRED }).default("none_type"),
  /** Any currency code of the currencies table (sum/SUM/usd/…; SUM, USD, EUR when the table is empty). */
  currency: z.string({ error: CURRENCY }).trim().min(1, CURRENCY).max(16, CURRENCY),
  amount: numeric(AMOUNT).pipe(z.number({ error: AMOUNT }).finite(AMOUNT).positive(AMOUNT).max(1e13, AMOUNT)),
  date: localDateTime.optional(),
  comment: z.string().trim().max(2000).optional(),
})

export type EmployeeBalanceTransactionBody = z.infer<typeof employeeBalanceTransactionSchema>
