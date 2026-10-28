import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { billingResponse } from "@/lib/subscriptions-api"
import { extendSubscriptions } from "@/lib/subscriptions-repo"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({ ids: z.array(z.number().int().positive()).min(1), period: z.number().int().positive() })

/** "Подтвердить" of "Продлить подписку". */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return billingResponse(await extendSubscriptions(parsed.data.ids, parsed.data.period))
}
