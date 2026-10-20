import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createTransportVehicle, listTransportVehicles, parseTransportVehicleInput, TRANSPORT_STATUSES } from "@/lib/transport-repo"

const transportVehicleSchema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  plateNumber: z.string().optional(),
  driver: z.string().optional(),
  branch: z.string().optional(),
  status: z.enum(TRANSPORT_STATUSES).optional(),
  note: z.string().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listTransportVehicles()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, transportVehicleSchema)
  if (parsed.error) return parsed.error

  const input = parseTransportVehicleInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const item = (await createTransportVehicle(input))
  return NextResponse.json(item, { status: 201 })
}
