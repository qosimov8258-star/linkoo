"use client"

import { CatalogView } from "@/components/products/catalog-view"

// "Сырье" (/analytics/raw-materials) — the same catalog page as "Продукты" (demo is_raw).
export function RawMaterialsView() {
  return <CatalogView kind="raw_material" />
}
