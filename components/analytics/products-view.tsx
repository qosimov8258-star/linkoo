"use client"

import { CatalogView } from "@/components/products/catalog-view"

// "Продукты" (/analytics/products) — the shared catalog page (components/products/**).
export function ProductsView() {
  return <CatalogView kind="product" />
}
