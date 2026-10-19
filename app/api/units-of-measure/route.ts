import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createUnitOfMeasure, listUnitsOfMeasure, parseUnitOfMeasureInput } from "@/lib/units-of-measure-repo"

const unitOfMeasureSchema = z.object({
  name: z.string().trim().min(1),
  parentId: z.unknown().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listUnitsOfMeasure()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, unitOfMeasureSchema)
  if (parsed.error) return parsed.error

  const input = parseUnitOfMeasureInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const unit = (await createUnitOfMeasure(input))
  return NextResponse.json(unit, { status: 201 })
}
