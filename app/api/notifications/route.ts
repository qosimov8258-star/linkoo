import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listUserNotifications } from "@/lib/user-notifications-repo"

function intParam(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = new URL(request.url).searchParams
  return NextResponse.json(await listUserNotifications(intParam(params.get("page"), 1), Math.min(100, intParam(params.get("pageSize"), 15))))
}
