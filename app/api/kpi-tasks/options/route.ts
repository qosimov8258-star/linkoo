import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { listTransport } from "@/lib/transport-repo"

type Item = { id: number; name: string }

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true })
const byName = (a: Item, b: Item) => collator.compare(a.name, b.name) || a.id - b.id

// GET /api/kpi-tasks/options — the lists the KPI form picks from (demo main/brand, main/product, main/border,
// main/market_type, main/branch, main/division, main/price_list, staff/transport …), as {id, name}.
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const db = getDb()
  const list = async (sql: string): Promise<Item[]> =>
    ((await db.prepare(sql).all()) as Array<{ id: number; name: string | null }>)
      .map((row) => ({ id: Number(row.id), name: String(row.name ?? "").trim() }))
      .filter((row) => row.name)
      .sort(byName)
  const [brands, products, productTypes, priceLists, zones, marketTypes, branches, organizations, currencies, transports] = await Promise.all([
    list("SELECT id, name FROM brands"),
    list("SELECT id, name FROM products"),
    list("SELECT id, name FROM product_types"),
    list("SELECT id, name FROM price_lists"),
    list("SELECT id, title AS name FROM zone_options"),
    list("SELECT id, name FROM client_types"),
    list("SELECT id, name FROM branches"),
    list("SELECT id, name FROM organizations"),
    db.prepare("SELECT id, name, is_base FROM currencies").all() as Promise<Array<{ id: number; name: string; is_base: number | boolean }>>,
    listTransport(),
  ])
  return NextResponse.json({
    brands,
    products,
    productTypes,
    // the demo's "Группы товаров" are the product types of the local base
    groupProducts: productTypes,
    priceLists,
    zones,
    marketTypes,
    branches,
    organizations,
    // the reference lists the base currency last
    currencies: [...currencies]
      .sort((a, b) => Number(Boolean(a.is_base)) - Number(Boolean(b.is_base)) || a.id - b.id)
      .map((row) => ({ id: Number(row.id), name: String(row.name) })),
    transports: transports.map((row) => ({ id: row.id, name: [row.model, row.number].filter(Boolean).join(" ") })).sort(byName),
  })
}
