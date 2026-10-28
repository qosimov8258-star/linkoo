import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { getOrderExcelSetting, updateOrderExcelCodes } from "@/lib/order-excel-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const schema = z.object({ codes: z.array(z.coerce.string()) })

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const item = await getOrderExcelSetting(Number((await params).id))
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}

// PUT {codes: [1, 2, …]} — the switched-on column numbers.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await updateOrderExcelCodes(Number((await params).id), parsed.data.codes)
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Не найдено" }, { status: 404 })
}
