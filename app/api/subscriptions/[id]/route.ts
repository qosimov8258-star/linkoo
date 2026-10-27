import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import {
  deleteSubscription,
  parseSubscriptionInput,
  updateSubscription,
  SUBSCRIPTION_PERIODS,
  SUBSCRIPTION_STATUSES,
} from "@/lib/subscriptions-repo"
import { strictNum } from "@/lib/strict-number"

const subscriptionSchema = z.object({
  planName: z.string().trim().min(1).max(255, "Не более 255 символов"),
  price: strictNum(z.number().finite().optional()),
  billingPeriod: z.enum(SUBSCRIPTION_PERIODS).optional(),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  renewsAt: z.string().optional(),
  note: z.string().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, subscriptionSchema)
  if (parsed.error) return parsed.error

  const input = parseSubscriptionInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Тариф обязателен" }, { status: 400 })

  const item = (await updateSubscription(id, input))
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = (await deleteSubscription(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
