import { NextResponse } from "next/server"
import { z } from "zod"

import { blockAllEmployees } from "@/lib/employees-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({ code: z.string().trim().min(1, "Обязательное поле").max(100, "Не более 100 символов"), block: z.boolean() })

/** "Ограничить доступ сотрудника": blocks / unblocks the system access of every active employee.
 * Blocking spares the caller's own employee and every employee linked to an administrator's account,
 * and ends the sessions of the accounts it blocks. */
export async function POST(request: Request) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const changed = await blockAllEmployees(parsed.data.block, { id: auth.user.id, role: auth.user.role })
  return NextResponse.json({ changed })
}
