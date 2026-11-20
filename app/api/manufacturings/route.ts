import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listManufacturings } from "@/lib/equipment-repo"
import { guarded } from "@/lib/production-api"

/** «Производство» options of Настройки → «Оборудования»: the production stages (lib/equipment-repo.ts). */
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return guarded(async () => NextResponse.json(await listManufacturings(request.nextUrl.searchParams.get("search") ?? "")))
}
