import { NextResponse } from "next/server"
import { z } from "zod"

import { employeeErrorResponse, idField, idListField } from "@/lib/employees-api"
import { bulkUpdateEmployees } from "@/lib/employees-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const REQUIRED = "Обязательное поле"

const bulkSchema = z.object({
  ids: idListField().min(1, "Выберите хотя бы одного сотрудника"),
  change: z.object({
    cashboxIds: idListField().optional(),
    branchIds: idListField().min(1, REQUIRED).optional(),
    supervisorId: idField().nullable().optional(),
    organizationIds: idListField().min(1, REQUIRED).optional(),
    stockIds: idListField().optional(),
    priceListIds: idListField().optional(),
    currencyIds: idListField().optional(),
    restrictions: z
      .object({ names: z.array(z.string().trim().min(1, REQUIRED).max(255, "Не более 255 символов")).max(100), replace: z.boolean() })
      .optional(),
  }),
})

/** "Изменить" dialog of the employee list: overwrites the ticked groups of fields for the selected employees.
 * A reference that does not exist answers 400 `{ error, fields, ids | names }` (an unknown employee 404)
 * and nothing is saved. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, bulkSchema)
  if (parsed.error) return parsed.error
  const result = await bulkUpdateEmployees(parsed.data.ids, parsed.data.change)
  if ("error" in result) return employeeErrorResponse(result)
  return NextResponse.json({ changed: result.changed })
}
