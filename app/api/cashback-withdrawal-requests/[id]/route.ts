import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { updateCashbackWithdrawalRequestStatus } from "@/lib/cashback-withdrawal-requests-repo"

const cashbackWithdrawalStatusSchema = z.object({
  status: z.enum(["confirmed", "rejected", "pending"]),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, cashbackWithdrawalStatusSchema)
  if (parsed.error) return parsed.error

  const updated = (await updateCashbackWithdrawalRequestStatus(id, parsed.data.status))
  if (!updated) return NextResponse.json({ error: "Запрос не найден" }, { status: 404 })
  return NextResponse.json(updated)
}
