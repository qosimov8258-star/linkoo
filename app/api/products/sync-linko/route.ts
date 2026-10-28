import { NextResponse } from "next/server"
import { z } from "zod"

import { sendProductsToLinko } from "@/lib/product-linko-sync-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const bodySchema = z.object({ ids: z.array(z.number().int().positive()).min(1, "Выберите продукты").max(5000) })

// POST /api/products/sync-linko {ids} — "Отправить продукты" (the reference's product_sync_linko/).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, bodySchema)
  if (parsed.error) return parsed.error
  const sent = await sendProductsToLinko(parsed.data.ids, auth.user.displayName || auth.user.username)
  return NextResponse.json({ sent })
}
