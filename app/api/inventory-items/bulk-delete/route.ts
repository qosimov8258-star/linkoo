import { NextResponse } from "next/server"

import { inventoryBulkDeleteSchema, inventoryErrorResponse } from "@/lib/inventory-items-api"
import { bulkDeleteInventoryItems } from "@/lib/inventory-items-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/inventory-items/bulk-delete { ids } — checkbox "Удалить" (all or nothing).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, inventoryBulkDeleteSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json({ deleted: await bulkDeleteInventoryItems(parsed.data.ids, auth.user) })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}
