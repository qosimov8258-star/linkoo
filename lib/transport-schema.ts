import { z } from "zod"

import { dbId, INVALID_ID, MAX_NUMBER_TEXT, NOT_A_NUMBER } from "@/lib/strict-number"

const REQUIRED = "Обязательное поле"

const text = z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(255, "Не более 255 символов")

/** Decimal text with an optional sign, no exponent: "12", "1 200,5", "-3" (refused by min). */
const AMOUNT_TEXT = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/

// Объем (л) / Грузоподъёмность (кг): a JSON number or a plain decimal text (spaces between digit
// groups and a decimal comma allowed, as the form masks them). Strict (lib/strict-number.ts):
// "" / null / missing are "Обязательное поле" (never 0); booleans, arrays, "0x10", "1e3",
// "Infinity" and "12abc" are refused.
const amount = z.preprocess(
  (value, ctx) => {
    if (typeof value === "number") return value
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
      ctx.issues.push({ code: "custom", message: REQUIRED, input: value })
      return z.NEVER
    }
    const cleaned = typeof value === "string" && value.length <= MAX_NUMBER_TEXT ? value.replace(/[\s  ]/g, "").replace(",", ".") : ""
    if (!AMOUNT_TEXT.test(cleaned)) {
      ctx.issues.push({ code: "custom", message: NOT_A_NUMBER, input: value })
      return z.NEVER
    }
    return Number(cleaned)
  },
  z.number({ error: REQUIRED }).min(0, "Введите число не меньше 0").max(1_000_000_000, "Слишком большое число"),
)

// The branch: a positive int4 id (a JSON number or a digit text), or none ("" / null / missing).
const branchId = z.preprocess((value) => (value === "" || value === undefined ? null : value), dbId(INVALID_ID).nullable())

export const transportSchema = z.object({
  model: text,
  number: text,
  driver: text,
  capacity: amount,
  loadLimit: amount,
  branchId,
})
