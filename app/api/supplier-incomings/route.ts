import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createIncoming, listIncomings, parseIncomingInput } from "@/lib/supplier-incomings-repo"

const supplierIncomingSchema = z.object({
  supplier: z.string().trim().min(1),
  warehouse: z.string().trim().min(1),
  branch: z.string().optional(),
  organization: z.string().optional(),
  paymentType: z.string().optional(),
  date: z.string().optional(),
  contractNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  comment: z.string().optional(),
  items: z.array(z.record(z.string(), z.unknown())).min(1),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listIncomings()))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, supplierIncomingSchema)
  if (parsed.error) return parsed.error

  const input = parseIncomingInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Поставщик, склад и товары обязательны" }, { status: 400 })

  return NextResponse.json((await createIncoming(input)), { status: 201 })
}
