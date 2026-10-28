import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { lookupClients } from "@/lib/clients-duplicates"

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = request.nextUrl.searchParams
  const ids = (params.get("ids") ?? "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0)
  return NextResponse.json(await lookupClients(params.get("search") ?? "", ids))
}
