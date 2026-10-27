import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { invalidFieldResponse, parseJsonBody } from "@/lib/validation"
import { createClientModuleItem, listClientModuleItems } from "@/lib/client-module-items-repo"

const clientModuleItemSchema = z.object({
  moduleKey: z.string().trim().min(1).max(255, "Не более 255 символов"),
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  category: z.string().trim().optional(),
  detail: z.string().trim().optional(),
  value: z.string().trim().optional(),
  status: z.enum(["active", "attention", "inactive"]).optional(),
  statusLabel: z.string().trim().optional(),
})

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const moduleKey = searchParams.get("moduleKey") || ""
  if (!moduleKey) return invalidFieldResponse("moduleKey", "required")

  return NextResponse.json((await listClientModuleItems(moduleKey)))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientModuleItemSchema)
  if (parsed.error) return parsed.error

  const status = parsed.data.status ?? "active"
  const item = await createClientModuleItem({
    moduleKey: parsed.data.moduleKey,
    name: parsed.data.name,
    category: parsed.data.category ?? "",
    detail: parsed.data.detail ?? "",
    value: parsed.data.value ?? "",
    status,
    statusLabel: parsed.data.statusLabel || status,
  })
  return NextResponse.json(item, { status: 201 })
}
