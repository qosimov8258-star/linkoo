import { NextResponse } from "next/server"
import { z } from "zod"

import { bulkUpdateEmployees } from "@/lib/employees-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const idList = z.array(z.number().int().positive())

const bulkSchema = z.object({
  ids: idList.min(1),
  change: z.object({
    cashboxIds: idList.optional(),
    branchIds: idList.min(1).optional(),
    supervisorId: z.number().int().positive().nullable().optional(),
    organizationIds: idList.min(1).optional(),
    stockIds: idList.optional(),
    priceListIds: idList.optional(),
    currencyIds: idList.optional(),
    restrictions: z.object({ names: z.array(z.string()), replace: z.boolean() }).optional(),
  }),
})

/** "Изменить" dialog of the employee list: overwrites the ticked groups of fields for the selected employees. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, bulkSchema)
  if (parsed.error) return parsed.error
  const changed = await bulkUpdateEmployees(parsed.data.ids, parsed.data.change)
  return NextResponse.json({ changed })
}
