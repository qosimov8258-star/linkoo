import { NextRequest } from "next/server"

import { entryResponse, importBodySchema } from "@/lib/net-cost-api"
import { importNetCostEntries } from "@/lib/net-cost-entries"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

/** "Импортировать с excel": {rows: string[][]} (first row = header: Наименование | Себестоимость | Дата | Склад). */
export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, importBodySchema)
  if (parsed.error) return parsed.error
  return entryResponse(await importNetCostEntries(parsed.data.rows, auth.user.displayName))
}
