import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getCashboxOptions } from "@/lib/cashboxes-repo"

// GET /api/cashboxes/options — the selects of the "Добавить кассу" / "Изменить кассу"
// dialog: currencies (currencies table, or SUM / USD / EUR while it is empty — the
// same set the cash core uses), employees (Кассир) and branches (Филиал).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await getCashboxOptions())
}
