import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createInventoryRecord, listInventoryRecords } from "@/lib/inventory-records-repo"

const inventoryRecordSchema = z.object({
  warehouse: z.string().trim().min(1),
  comment: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listInventoryRecords()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, inventoryRecordSchema)
  if (parsed.error) return parsed.error

  const record = (await createInventoryRecord({
    warehouse: parsed.data.warehouse,
    comment: parsed.data.comment || "Комментариев нет",
  }))
  return NextResponse.json(record, { status: 201 })
}
