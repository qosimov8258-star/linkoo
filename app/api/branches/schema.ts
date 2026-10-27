import { NextResponse } from "next/server"
import { z } from "zod"

import { BranchError } from "@/lib/branches-repo"
import { nameField, textField } from "@/lib/auth-request"

export const branchSchema = z.object({
  name: nameField("Укажите название филиала", 120),
  priceList: textField(200).optional(),
  currency: z.enum(["SUM", "USD", "Euro"], { error: "Неизвестная валюта" }).optional(),
  debtTracking: z.boolean().optional(),
  isMain: z.boolean().optional(),
})

export function branchErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof BranchError)) return null
  return NextResponse.json({ error: error.message, ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
}
