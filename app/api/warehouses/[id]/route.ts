import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteWarehouse, parseWarehouseInput, updateWarehouse } from "@/lib/warehouses-repo"

const warehouseSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
  branch: z.string().optional(),
  manager: z.string().optional(),
  online: z.boolean().optional(),
  active: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, warehouseSchema)
  if (parsed.error) return parsed.error

  const input = parseWarehouseInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование и адрес обязательны" }, { status: 400 })

  const warehouse = (await updateWarehouse(id, input))
  if (!warehouse) return NextResponse.json({ error: "Склад не найден" }, { status: 404 })
  return NextResponse.json(warehouse)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteWarehouse(id))
  if (!ok) return NextResponse.json({ error: "Склад не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
