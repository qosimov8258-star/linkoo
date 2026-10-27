import { z } from "zod"

import { cashboxTypeOf } from "@/components/analytics/cashboxes-data"
import { strictNum, strictNumber } from "@/lib/strict-number"

// Request schemas of /api/cashboxes (demo finance/cashbox/ serializer: name,
// currency, cashier and type are required; position is required by the dialog).
// Messages are Russian i18n keys; the dialog shows them under the fields.

const REQUIRED = "Обязательное поле"
const MAX_INT = 2_147_483_647

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value)
const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value)
/** "12" → 12, "" / null → undefined (required error), other strings ("0x10", "12abc") → NaN (number error). */
const toNumberOrUndefined = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return undefined
  if (typeof value === "string") return value.trim() ? strictNumber(value) : undefined
  return value
}

/** A positive int4 id given as a number or a digits-only string (no booleans, arrays or "1e1"). */
const idSchema = z
  .union([z.number(), z.string().trim().regex(/^\d+$/, "Неверный идентификатор").transform(Number)], { error: "Неверный идентификатор" })
  .pipe(z.number().int("Неверный идентификатор").positive("Неверный идентификатор").max(MAX_INT, "Неверный идентификатор"))
const optionalId = z.preprocess(emptyToNull, idSchema.nullable()).optional()

export const cashboxInputSchema = z
  .object({
    name: z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(255, "Не более 255 символов"),
    currency: z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(32),
    cashierId: optionalId,
    /** Cashier name (Excel import, old callers). */
    cashier: z.string().trim().max(255).optional(),
    branchId: optionalId,
    /** Branch name (Excel import, old callers); "" = no branch. */
    branch: z.string().trim().max(255).optional(),
    /** cash | bank | "наличный" | "банковский счет" (any spelling the cash core understands). */
    paymentType: z.string().trim().optional(),
    /** Demo field name of paymentType. */
    type: z.string().trim().optional(),
    vansell: z.boolean().optional(),
    /** Demo field name of vansell. */
    isVanSell: z.boolean().optional(),
    /** Demo `position` ("Порядковый номер"). */
    orderNumber: z.preprocess(
      toNumberOrUndefined,
      z
        .number({ error: (issue) => (issue.input === undefined ? REQUIRED : "Введите целое число") })
        .int("Введите целое число")
        .min(0, "Введите целое число не меньше 0")
        .max(MAX_INT, "Слишком большое число"),
    ),
  })
  .superRefine((value, ctx) => {
    if (!value.cashierId && !value.cashier) ctx.addIssue({ code: "custom", path: ["cashier"], message: REQUIRED })
    const rawType = value.paymentType || value.type
    if (!rawType) ctx.addIssue({ code: "custom", path: ["paymentType"], message: REQUIRED })
    else if (!cashboxTypeOf(rawType)) ctx.addIssue({ code: "custom", path: ["paymentType"], message: "Неизвестный тип оплаты" })
  }, {
    // Also run when other fields failed, so one response lists every missing field.
    when: (payload) => typeof payload.value === "object" && payload.value !== null,
  })
export type CashboxInputBody = z.infer<typeof cashboxInputSchema>

const text = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional())
const int = (min: number, max: number) => z.preprocess(emptyToUndefined, strictNum(z.number().int().min(min).max(max).optional()))

export const cashboxListQuerySchema = z.object({
  search: text(200),
  page: int(1, 1_000_000),
  pageSize: int(1, 2000),
})
export type CashboxListQuery = z.infer<typeof cashboxListQuerySchema>

/** Query string → object; accepts the demo `page_size` and the old `q` search names. */
export function cashboxQueryObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of params) out[key] = value
  if (out.pageSize === undefined && out.page_size !== undefined) out.pageSize = out.page_size
  if (out.search === undefined && out.q !== undefined) out.search = out.q
  return out
}

/** The paged {count, results} shape only on request, so every cashbox select keeps the plain array. */
export function wantsPagedCashboxes(params: URLSearchParams): boolean {
  return params.has("page") || params.has("pageSize") || params.has("page_size") || params.get("paged") === "1"
}

export function parseCashboxId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 && id <= MAX_INT ? id : null
}
