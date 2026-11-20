import { NextRequest, NextResponse } from "next/server"

import { createEquipment, listEquipment } from "@/lib/equipment-repo"
import { getCurrentUser } from "@/lib/current-user"
import { guarded, parseBody } from "@/lib/production-api"
import { equipmentSettingsSchema } from "@/lib/production-staffeq-schemas"
import { requireRole } from "@/lib/rbac"

// Настройки → «Оборудования»: the production equipment of every stage (lib/equipment-repo.ts).

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return guarded(async () => NextResponse.json(await listEquipment(request.nextUrl.searchParams.get("search") ?? "")))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, equipmentSettingsSchema)
  if (parsed.error) return parsed.error
  const input = parsed.data
  return guarded(async () => NextResponse.json(await createEquipment({ name: input.name, manufacturingId: input.manufacturingId, photo: input.photo }), { status: 201 }))
}
