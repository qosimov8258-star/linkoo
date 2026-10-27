import { NextResponse } from "next/server"

import { inventoryErrorResponse, inventoryImportSchema } from "@/lib/inventory-items-api"
import { importInventoryItems } from "@/lib/inventory-items-import"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/inventory-items/import { rows } — "Импорт с Excel" → { created }; 400 { error, lines: [{line, error}] }.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, inventoryImportSchema)
  if (parsed.error) return parsed.error
  try {
    // Inactive warehouses are refused per line, with the file's other errors (importInventoryItems).
    return NextResponse.json(await importInventoryItems(parsed.data.rows, auth.user), { status: 201 })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}
