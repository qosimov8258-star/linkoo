import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createIndividualRate, listIndividualRates } from "@/lib/currency-rates-repo"
import { individualRateSchema } from "@/lib/currency-rates-schema"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listIndividualRates())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, individualRateSchema)
  if (parsed.error) return parsed.error

  return NextResponse.json(await createIndividualRate(parsed.data), { status: 201 })
}
