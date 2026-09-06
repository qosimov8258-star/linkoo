import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createWarehouse, listWarehouses, parseWarehouseInput } from "@/lib/warehouses-repo"

const warehouseSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
  branch: z.string().optional(),
  manager: z.string().optional(),
  online: z.boolean().optional(),
  active: z.boolean().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listWarehouses()))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, warehouseSchema)
  if (parsed.error) return parsed.error

  const input = parseWarehouseInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование и адрес обязательны" }, { status: 400 })

  return NextResponse.json((await createWarehouse(input)), { status: 201 })
}
