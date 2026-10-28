import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { detachSubscriptions } from "@/lib/subscriptions-repo"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({ ids: z.array(z.number().int().positive()).min(1) })

/** "Открепить": removes the subscription of the selected employees. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return NextResponse.json({ removed: await detachSubscriptions(parsed.data.ids) })
}
