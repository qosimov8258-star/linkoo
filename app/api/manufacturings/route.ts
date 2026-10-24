import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listManufacturings } from "@/lib/equipment-repo"

export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listManufacturings(request.nextUrl.searchParams.get("search") ?? ""))
}
