import { NextResponse } from "next/server"
import { z } from "zod"

import { BranchError } from "@/lib/branches-repo"
import { nameField, textField } from "@/lib/auth-request"

// priceList: a price list of Прайс-листы ("" / "Не указано" = none); currency: a
// currency of Валюты (code or alias: SUM, USD, EUR / Euro, …). Both are resolved
// by lib/branches-repo.ts (400 "Прайс-лист не найден" / "Валюта не найдена").
// An omitted currency reads as "" = the base currency on create, unchanged on update.
// locationLat / locationLng: the map point of the branch form (null = none; omitted = unchanged on update).
const coordinate = (limit: number) =>
  z
    .number({ error: "Неверная координата" })
    .finite({ error: "Неверная координата" })
    .min(-limit, { error: "Неверная координата" })
    .max(limit, { error: "Неверная координата" })
    .nullable()
    .optional()

export const branchSchema = z.object({
  name: nameField("Укажите название филиала", 120),
  priceList: textField(200).optional(),
  currency: textField(20)
    .optional()
    .transform((value) => value ?? ""),
  debtTracking: z.boolean().optional(),
  isMain: z.boolean().optional(),
  locationLat: coordinate(90),
  locationLng: coordinate(180),
})

export function branchErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof BranchError)) return null
  return NextResponse.json({ error: error.message, ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
}
