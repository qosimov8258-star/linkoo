import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseRepricingId } from "@/lib/repricings-api"
import { recalcRepricing } from "@/lib/repricings-repo"

type RouteParams = { params: Promise<{ id: string }> }

// PUT /api/repricings/[id]/recalc — demo PUT main/reprice/:id/recalc/ ("Перерасчет по текущей
// дате"): Кол-во of every line = the current available stock; the sums are recomputed. Prices are
// not touched.
export async function PUT(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRepricingId((await params).id)
  const repricing = id ? await recalcRepricing(id) : null
  if (!repricing) return NextResponse.json({ error: "Переоценка не найдена" }, { status: 404 })
  return NextResponse.json(repricing)
}

export const POST = PUT
