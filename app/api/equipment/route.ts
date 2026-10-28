import { NextRequest, NextResponse } from "next/server"

import { createEquipment, equipmentInputSchema, listEquipment } from "@/lib/equipment-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listEquipment(request.nextUrl.searchParams.get("search") ?? ""))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, equipmentInputSchema)
  if (parsed.error) return parsed.error
  const item = await createEquipment({ name: parsed.data.name, manufacturingId: parsed.data.manufacturingId ?? null, photo: parsed.data.photo })
  return NextResponse.json(item, { status: 201 })
}
