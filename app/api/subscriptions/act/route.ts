import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getAct } from "@/lib/subscriptions-repo"

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const begin = params.get("begin") ?? ""
  const end = params.get("end") ?? ""
  if (!DATE.test(begin) || !DATE.test(end) || begin > end) return NextResponse.json({ error: "Укажите период" }, { status: 400 })
  return NextResponse.json(await getAct(begin, end))
}
