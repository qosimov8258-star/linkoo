import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { INTEGRATION_TYPES } from "@/lib/integrations-types"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(INTEGRATION_TYPES)
}
