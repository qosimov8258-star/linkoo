import { NextResponse } from "next/server"
import { z } from "zod"

import { addNotificationTemplateUser } from "@/lib/notification-templates-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({ userId: z.number().int().positive() })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const result = await addNotificationTemplateUser(Number((await params).id), parsed.data.userId)
  if (result === "no-template") return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  if (result === "no-user") return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 })
  if (result === "duplicate") return NextResponse.json({ error: "Пользователь уже привязан" }, { status: 409 })
  return NextResponse.json({ ok: true }, { status: 201 })
}
