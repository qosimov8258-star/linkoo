import { NextRequest, NextResponse } from "next/server"

import { actionBodySchema, toActionInput } from "@/lib/net-cost-api"
import { runNetCostAction } from "@/lib/net-cost-repo"
import type { NetCostActionKind } from "@/lib/net-cost-types"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ action: string }> }

const ACTIONS: NetCostActionKind[] = ["recheck", "recalc", "recalc-period", "reset-period", "regenerate"]

/** "Проверить" (recheck), "Перерасчет" (recalc), "Пересчитать" (recalc-period), "Перезаписать"
 * (reset-period), "Сгенерировать заново" (regenerate) — see lib/net-cost-repo.ts. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const action = (await params).action as NetCostActionKind
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "Неизвестное действие" }, { status: 404 })
  const text = await request.clone().text()
  const parsed = text.trim() ? await parseJsonBody(request, actionBodySchema) : { data: {} as Record<string, never> }
  if ("error" in parsed && parsed.error) return parsed.error
  const input = toActionInput(parsed.data ?? {})
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 })
  return NextResponse.json(await runNetCostAction(action, input))
}
