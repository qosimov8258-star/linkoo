import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import {
  createSubscription,
  listSubscriptions,
  parseSubscriptionInput,
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

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listSubscriptions()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, subscriptionSchema)
  if (parsed.error) return parsed.error

  const input = parseSubscriptionInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Тариф обязателен" }, { status: 400 })

  const item = (await createSubscription(input))
  return NextResponse.json(item, { status: 201 })
}
