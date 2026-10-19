import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { writeOffOptions } from "@/lib/write-offs-repo"

/** Filter / dialog lookups: warehouses and creators. */
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await writeOffOptions())
}
