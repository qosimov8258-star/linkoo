import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { createClientDebtLimit, getDebtLimitTypes, listClientDebtLimits } from "@/lib/client-debt-limits-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { dbId, strictId, strictNum } from "@/lib/strict-number"
import { parseJsonBody } from "@/lib/validation"

const MAX_MONEY = 1e13

const createSchema = z.object({
  client: dbId("Укажите клиента"),
  organization: dbId("Выберите организацию"),
  amount: strictNum(
    z.number({ error: "Неверная сумма" }).finite("Неверная сумма").min(0, "Сумма не может быть отрицательной").max(MAX_MONEY, "Слишком большая сумма"),
    "Неверная сумма",
  ),
})

/** Mirrors the reference `market/debt_limit/`: `?client=<id>` lists one client's limits, `?types=1` the filter types. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  if (request.nextUrl.searchParams.get("types")) return NextResponse.json(await getDebtLimitTypes())

  const client = strictId(request.nextUrl.searchParams.get("client"))
  if (client === null) return NextResponse.json({ error: "Укажите клиента" }, { status: 400 })
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
