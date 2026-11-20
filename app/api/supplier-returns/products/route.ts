import { NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { listReturnProducts } from "@/lib/supplier-returns-products"

// GET /api/supplier-returns/products?warehouse=&priceList= → { rows: ReturnProductOption[] }: the products of the return
// form (Linko's stock/all_balance_supply/): every product with its balance in `warehouse` (all warehouses without it)
// and its price in `priceList`.
export async function GET(request: Request) {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  const search = new URL(request.url).searchParams
  const warehouse = (search.get("warehouse") ?? "").slice(0, 255)
  const priceList = (search.get("priceList") ?? "").slice(0, 255)
  return NextResponse.json({ rows: await listReturnProducts({ warehouse, priceList }) })
}
