import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listNotificationTemplates } from "@/lib/notification-templates-repo"

function intParam(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = new URL(request.url).searchParams
  return NextResponse.json(await listNotificationTemplates(params.get("search") ?? "", intParam(params.get("page"), 1), Math.min(2000, intParam(params.get("pageSize"), 25))))
}
