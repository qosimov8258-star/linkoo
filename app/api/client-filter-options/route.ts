import { NextResponse } from "next/server"

import { getClientFilterOptions } from "@/lib/client-filter-options-repo"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/client-filter-options — the select lists of the clients filter panel.
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await getClientFilterOptions())
}
