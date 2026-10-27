import "server-only"

import { z } from "zod"

import { MAX_MONEY } from "@/lib/finance/api"
import { docDateCheck } from "@/lib/document-dates"
import { parseAnyDate } from "@/lib/finance/dates"
import { dbId, decimalText } from "@/lib/strict-number"

// Request body of POST /api/balances/deliverer-debts/corrections — the demo's
// "КОРРЕКТИРОВКА" dialog (module 5064, plan createAddSerializer: amount as
// typed, currency, payment_type, division, created_date "YYYY-MM-DD HH:mm",
// user, comment, delivery_man, type 9). Dates are local Asia/Tashkent
// "YYYY-MM-DDTHH:mm" (datetime-local), "YYYY-MM-DD HH:mm" or "YYYY-MM-DD".

// A correction is a money document: year 2000..2100, never after today (lib/document-dates.ts).
const localDateTime = z
  .string()
  .trim()
  .refine((value) => /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.test(value) && parseAnyDate(value) !== null, "YYYY-MM-DDTHH:mm")
  .superRefine(docDateCheck())

/** A number or a plain decimal string (booleans, arrays, null and "0x10" are rejected). */
const numeric = z.union([z.number(), decimalText()])

export const delivererCorrectionSchema = z.object({
  /** employees.id of the deliverer (demo delivery_man). */
  employeeId: dbId(),
  currency: z.string().trim().min(1).max(16),
  /** Signed as typed (demo keeps the sign); 0 is rejected. */
  amount: numeric.pipe(
    z
      .number()
      .finite()
      .refine((value) => value !== 0, "≠ 0")
      .refine((value) => Math.abs(value) <= MAX_MONEY, "≤ 1e13"),
  ),
  paymentType: z.enum(["cash", "bank", ""]).default(""),
  /** Organization (demo division) name; "" = not set. */
  organization: z.string().trim().max(200).default(""),
  date: localDateTime.optional(),
  comment: z.string().trim().max(2000).default(""),
  /** "Создал" (demo user); default = the signed-in user. */
  createdBy: z.string().trim().max(200).optional(),
})

export type DelivererCorrectionBody = z.infer<typeof delivererCorrectionSchema>
