import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { billingResponse } from "@/lib/subscriptions-api"
import { attachSubscriptions } from "@/lib/subscriptions-repo"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({ ids: z.array(z.number().int().positive()).min(1), licenseKey: z.string().trim().min(1) })

/** "Прикрепить": gives the chosen license to the selected employees. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return billingResponse(await attachSubscriptions(parsed.data.ids, parsed.data.licenseKey))
}
