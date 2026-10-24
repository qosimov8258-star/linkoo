import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listAuthLogs } from "@/lib/auth-logs-repo"

const DATE = /^\d{4}-\d{2}-\d{2}$/
const date = (value: string | null) => (value && DATE.test(value) ? value : "")

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const userId = Number(params.get("user"))
  const result = await listAuthLogs({
    tab: params.get("tab") === "not_active" ? "not_active" : "active",
    search: (params.get("search") ?? "").trim(),
    userId: Number.isInteger(userId) && userId > 0 ? userId : null,
    createdFrom: date(params.get("createdFrom")),
    createdTo: date(params.get("createdTo")),
    lastFrom: date(params.get("lastFrom")),
    lastTo: date(params.get("lastTo")),
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: Math.min(2000, Math.max(1, Number(params.get("pageSize")) || 25)),
  })
  return NextResponse.json(result)
}
