import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import type { IncomingChange } from "@/lib/supplier-incomings-repo"

export const supplierIncomingSchema = z.object({
  supplier: z.string().trim().min(1),
  warehouse: z.string().trim().min(1),
  branch: z.string().optional(),
  organization: z.string().optional(),
  paymentType: z.string().optional(),
  currency: z.string().optional(),
  date: z.string().optional(),
  contractNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  comment: z.string().optional(),
  items: z.array(z.record(z.string(), z.unknown())).min(1),
})

export function incomingChangeResponse(result: IncomingChange, lockedMessage: string) {
  if (result === "not_found") return NextResponse.json({ error: "Приемка не найдена" }, { status: 404 })
  if (result === "locked") return NextResponse.json({ error: lockedMessage }, { status: 409 })
  return NextResponse.json(result)
}
