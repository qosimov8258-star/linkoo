import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { marketResponsibleUsers, taskMarketOptions, taskUserOptions } from "@/lib/task-items-repo"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const p = new URL(request.url).searchParams
  const kind = p.get("kind")
  const search = p.get("search") ?? ""
  const page = Number(p.get("page")) || 1
  const pageSize = Math.min(Number(p.get("page_size")) || 50, 200)
  if (kind === "users") return NextResponse.json(await taskUserOptions(search, page, pageSize))
  if (kind === "markets") return NextResponse.json(await taskMarketOptions(search, page, pageSize))
  if (kind === "market-users") return NextResponse.json(await marketResponsibleUsers(Number(p.get("market"))))
  return NextResponse.json({ error: "Неизвестный запрос" }, { status: 400 })
}
