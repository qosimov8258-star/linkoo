import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { createClientDebtLimit, getDebtLimitTypes, listClientDebtLimits } from "@/lib/client-debt-limits-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const createSchema = z.object({
  client: z.number().int().positive(),
  organization: z.number().int().positive(),
  amount: z.number().finite().min(0),
})

/** Mirrors the reference `market/debt_limit/`: `?client=<id>` lists one client's limits, `?types=1` the filter types. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  if (request.nextUrl.searchParams.get("types")) return NextResponse.json(await getDebtLimitTypes())

  const client = Number(request.nextUrl.searchParams.get("client"))
  if (!Number.isInteger(client) || client <= 0) return NextResponse.json({ error: "Укажите клиента" }, { status: 400 })
  const results = await listClientDebtLimits(client)
  return NextResponse.json({ count: results.length, results })
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, createSchema)
  if (parsed.error) return parsed.error

  const created = await createClientDebtLimit({ clientId: parsed.data.client, organizationId: parsed.data.organization, amount: parsed.data.amount })
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: created.status })
  return NextResponse.json(created.limit, { status: 201 })
}
