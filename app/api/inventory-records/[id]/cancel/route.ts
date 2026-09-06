import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { cancelInventoryRecord } from "@/lib/inventory-records-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const record = (await cancelInventoryRecord(id))
  if (!record) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(record)
}
