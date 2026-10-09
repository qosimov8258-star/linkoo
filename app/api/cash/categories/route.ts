import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listCashCategories } from "@/lib/cash/cashboxes"

// GET /api/cash/categories?kind=income|expense → { categories: CategoryInfo[] }
// (id, name, kind, options[], internal, excludeFromPnl, parentId).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const kind = new URL(request.url).searchParams.get("kind")
  if (kind && kind !== "income" && kind !== "expense") return NextResponse.json({ error: "Ma'lumotlar noto'g'ri" }, { status: 400 })
  return NextResponse.json({ categories: await listCashCategories(kind ? (kind as "income" | "expense") : undefined) })
}
