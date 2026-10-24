import { NextResponse } from "next/server"
import { z } from "zod"

import { setNotificationTemplateStatus } from "@/lib/notification-templates-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({ status: z.enum(["on", "off"]) })

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await setNotificationTemplateStatus(Number((await params).id), parsed.data.status)
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}
