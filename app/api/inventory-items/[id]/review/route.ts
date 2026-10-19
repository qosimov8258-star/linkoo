import { NextResponse } from "next/server"

import { inventoryErrorResponse, inventoryReviewSchema, parseInventoryId } from "@/lib/inventory-items-api"
import { NOT_FOUND, reviewInventoryItem } from "@/lib/inventory-items-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/inventory-items/[id]/review { isReviewed } — "Одобрить" / "Не одобрить" (+ a "История проверки" row).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseInventoryId((await params).id)
  if (!id) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  const parsed = await parseJsonBody(request, inventoryReviewSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await reviewInventoryItem(id, parsed.data.isReviewed, auth.user))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}
