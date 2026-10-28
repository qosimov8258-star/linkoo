import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listDuplicateGroups } from "@/lib/clients-duplicates"

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = request.nextUrl.searchParams
  return NextResponse.json(await listDuplicateGroups(params.get("by") === "phone" ? "phone" : "inn", params.get("search") ?? ""))
}
