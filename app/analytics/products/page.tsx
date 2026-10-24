import type { Metadata } from "next"

import { ProductsView } from "@/components/analytics/products-view"
import { getAnalyticsReport } from "@/lib/analytics-catalog"
import { getServerT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  const report = getAnalyticsReport("products")
  return { title: `${t(report?.label ?? "products")} — Linko` }
}

export default function Page() {
  return <ProductsView />
}
