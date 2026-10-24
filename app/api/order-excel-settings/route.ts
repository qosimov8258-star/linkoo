import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listOrderExcelSettings } from "@/lib/order-excel-repo"

// GET /api/order-excel-settings?search — demo saas/excel_code/: {count, results: [{id, name, key, codes}]}.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const results = await listOrderExcelSettings(new URL(request.url).searchParams.get("search") ?? "")
  return NextResponse.json({ count: results.length, results })
}
