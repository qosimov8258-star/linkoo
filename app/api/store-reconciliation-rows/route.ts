import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import {
  createStoreReconciliationRow,
  listStoreReconciliationRows,
  parseStoreReconciliationRowInput,
} from "@/lib/store-reconciliation-repo"

const storeReconciliationRowSchema = z.object({
  client: z.string().trim().min(1),
  connected: z.boolean().optional(),
  debtTerm: z.string().optional(),
  daysAfterPayment: z.coerce.number().finite().optional(),
  daysAfterOrder: z.coerce.number().finite().optional(),
  amountSum: z.coerce.number().finite().optional(),
  amountEuro: z.coerce.number().finite().optional(),
  sumCash: z.coerce.number().finite().optional(),
  sumTransfer: z.coerce.number().finite().optional(),
  usdCash: z.coerce.number().finite().optional(),
  usdTransfer: z.coerce.number().finite().optional(),
  euroCash: z.coerce.number().finite().optional(),
  euroTransfer: z.coerce.number().finite().optional(),
  orders: z.coerce.number().finite().optional(),
  altSumTransfer: z.coerce.number().finite().optional(),
  altAmountSum: z.coerce.number().finite().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listStoreReconciliationRows()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, storeReconciliationRowSchema)
  if (parsed.error) return parsed.error

  const input = parseStoreReconciliationRowInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Название клиента обязательно" }, { status: 400 })

  const row = (await createStoreReconciliationRow(input))
  return NextResponse.json(row, { status: 201 })
}
