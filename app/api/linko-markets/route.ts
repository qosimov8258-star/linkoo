import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listLinkoMarkets } from "@/lib/linko-markets-repo"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const search = new URL(request.url).searchParams.get("search") ?? ""
  return NextResponse.json(await listLinkoMarkets(search))
}
