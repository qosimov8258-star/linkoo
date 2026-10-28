import { z } from "zod"

import type { ReceiptTemplatePayload } from "@/components/analytics/receipt-templates-data"

const lineSchema = z.object({ name: z.string().optional().default(""), isBold: z.boolean().optional().default(false), position: z.string().optional().default("") })

const bodySchema = z.object({
  name: z.string().optional().default(""),
  printAutoCheck: z.boolean().optional().default(false),
  headers: z.array(lineSchema).optional().default([]),
  footers: z.array(lineSchema).optional().default([]),
})

export const REQUIRED_MESSAGE = "Это поле обязательно к заполнению"

/** Field errors keyed like the demo API ("name"); null for an unreadable body. */
export async function readReceiptBody(request: Request): Promise<{ data: ReceiptTemplatePayload; fields: Record<string, string> } | null> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return null
  const data = parsed.data as ReceiptTemplatePayload
  return { data, fields: data.name.trim() ? {} : { name: REQUIRED_MESSAGE } }
}
