import { NextResponse } from "next/server"
import { z } from "zod"

import { blockAllEmployees } from "@/lib/employees-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({ code: z.string().trim().min(1, "Обязательное поле"), block: z.boolean() })

/** "Ограничить доступ сотрудника": blocks / unblocks the system access of every active employee. */
export async function POST(request: Request) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return NextResponse.json({ changed: await blockAllEmployees(parsed.data.block) })
}
