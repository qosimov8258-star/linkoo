import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"

/** Product names (with the supply price the reference prefills) in the reference's own "all balances" sequence (product_reference_order): the default order of "Добавление продуктов". */
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const db = getDb()
  const exists = (await db.prepare("SELECT to_regclass('product_reference_order') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!exists?.ok) return NextResponse.json([])
  const rows = (await db.prepare("SELECT p.name, o.price FROM product_reference_order o JOIN products p ON p.id = o.product_id ORDER BY o.seq").all()) as { name: string; price: number | null }[]
  return NextResponse.json(rows.map((row) => ({ name: row.name, price: row.price })))
}
