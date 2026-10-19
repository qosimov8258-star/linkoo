import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createTransfer, listTransfers, type TransferInput } from "@/lib/internal-transfers-repo"

const ALLOWED_STATUSES = ["принят", "потвержден", "отменен"] as const

const transferItemSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  product: z.union([z.string(), z.number()]).optional(),
  quantity: z.union([z.number(), z.string()]).optional(),
  weight: z.union([z.number(), z.string()]).optional(),
  price: z.union([z.number(), z.string()]).optional(),
})

const transferSchema = z.object({
  fromWarehouse: z.string().trim().min(1),
  toWarehouse: z.string().trim().min(1),
  createdAt: z.string().optional(),
  deliveredAt: z.string().optional(),
  priceList: z.string().optional(),
  organization: z.string().optional(),
  invoiceNumber: z.string().optional(),
  transportNumber: z.string().optional(),
  driver: z.string().optional(),
  comment: z.string().optional(),
  status: z.string().optional(),
  items: z.array(transferItemSchema).optional(),
})

function toTransferInput(data: z.infer<typeof transferSchema>): TransferInput {
  const status = (data.status && (ALLOWED_STATUSES as readonly string[]).includes(data.status) ? data.status : "потвержден") as TransferInput["status"]
  return {
    fromWarehouse: data.fromWarehouse,
    toWarehouse: data.toWarehouse,
    createdAt: data.createdAt || new Date().toISOString().slice(0, 10),
    deliveredAt: data.deliveredAt || new Date().toISOString().slice(0, 10),
    priceList: data.priceList ?? "",
    organization: data.organization ?? "",
    invoiceNumber: data.invoiceNumber ?? "",
    transportNumber: data.transportNumber ?? "",
    driver: data.driver ?? "",
    comment: data.comment ?? "",
    status,
    items: (data.items ?? []).map((item, index) => ({
      id: Number(item.id) || index + 1,
      product: String(item.product ?? ""),
      quantity: Number(item.quantity) || 0,
      weight: Number(item.weight) || 0,
      price: Number(item.price) || 0,
    })),
  }
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listTransfers()))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, transferSchema)
  if (parsed.error) return parsed.error

  return NextResponse.json((await createTransfer(toTransferInput(parsed.data))), { status: 201 })
}
