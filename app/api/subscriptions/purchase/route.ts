import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { billingResponse } from "@/lib/subscriptions-api"
import { purchasePackages } from "@/lib/subscriptions-repo"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({
  period: z.number().int().positive(),
  startDate: z.string(),
  items: z.array(z.object({ licenseKey: z.string().min(1), count: z.number().int().min(0).max(100000) })),
})

/** "Купить подписку": a package per license type for the chosen period, paid from the balance. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return billingResponse(await purchasePackages(parsed.data), "Укажите количество лицензий")
}
