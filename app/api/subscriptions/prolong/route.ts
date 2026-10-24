import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getProlongPrice } from "@/lib/subscriptions-repo"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const ids = (new URL(request.url).searchParams.get("users") ?? "")
    .split(",")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0)
  return NextResponse.json(await getProlongPrice(ids))
}
