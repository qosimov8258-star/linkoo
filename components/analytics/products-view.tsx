"use client"

import { CatalogView } from "@/components/products/catalog-view"

// "Продукты" (/analytics/products) — the shared catalog page (components/products/**).
export function ProductsView({ initialDetailId }: { initialDetailId?: number }) {
  return <CatalogView kind="product" initialDetailId={initialDetailId} />
}
